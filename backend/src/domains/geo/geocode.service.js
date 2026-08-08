import { parseNominatimReverse, parseNominatimSearchResult } from '../../utils/nominatim.js';
import { parseGoogleGeocodeResult, parseGoogleSearchResult } from '../../utils/googleGeocode.js';
import { cached, roundCoord } from '../../utils/ttlCache.js';

const NOMINATIM_HEADERS = {
	'User-Agent': 'GrabitApp/1.0 (Contact: support@grabit.local)',
	Accept: 'application/json',
};
const GEOCODE_TIMEOUT_MS = 5000;

/** Cache TTLs — keep Maps quality, avoid paying twice for the same pin/query */
const TTL = {
	search: Number(process.env.MAPS_CACHE_TTL_SEARCH_MS || 6 * 60 * 60_000), // 6h
	reverse: Number(process.env.MAPS_CACHE_TTL_REVERSE_MS || 24 * 60 * 60_000), // 24h
	autocomplete: Number(process.env.MAPS_CACHE_TTL_AUTOCOMPLETE_MS || 30 * 60_000), // 30m
	details: Number(process.env.MAPS_CACHE_TTL_DETAILS_MS || 24 * 60 * 60_000), // 24h
	matrix: Number(process.env.MAPS_CACHE_TTL_MATRIX_MS || 60 * 60_000), // 1h
};

function getGoogleMapsApiKey() {
	return process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
}

/**
 * google = always Distance Matrix when key set
 * haversine = free estimate (default for high-frequency tracking)
 * auto = Matrix for quotes, haversine elsewhere (set via options.purpose)
 */
function distanceMode() {
	return (process.env.MAPS_DISTANCE_MODE || 'auto').toLowerCase();
}

async function fetchJson(url, headers = {}) {
	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error('Geocoding service error');
	return response.json();
}

async function searchWithGoogle(query) {
	const apiKey = getGoogleMapsApiKey();
	const searchUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
	searchUrl.searchParams.set('address', query);
	searchUrl.searchParams.set('components', 'country:IN');
	searchUrl.searchParams.set('key', apiKey);

	const data = await fetchJson(searchUrl);
	if (data.status === 'ZERO_RESULTS') return [];
	if (data.status !== 'OK') {
		throw new Error(data.error_message || `Google geocode search failed: ${data.status}`);
	}
	return (data.results ?? []).slice(0, 8).map(parseGoogleSearchResult);
}

async function reverseWithGoogle(latitude, longitude) {
	const apiKey = getGoogleMapsApiKey();
	const reverseUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
	reverseUrl.searchParams.set('latlng', `${latitude},${longitude}`);
	reverseUrl.searchParams.set('key', apiKey);

	const data = await fetchJson(reverseUrl);
	if (data.status === 'ZERO_RESULTS') {
		throw new Error('No address found for this location');
	}
	if (data.status !== 'OK' || !data.results?.[0]) {
		throw new Error(data.error_message || `Google reverse geocode failed: ${data.status}`);
	}
	return parseGoogleGeocodeResult(data.results[0], latitude, longitude);
}

async function searchWithNominatim(query) {
	const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
	searchUrl.searchParams.set('format', 'json');
	searchUrl.searchParams.set('q', query);
	searchUrl.searchParams.set('addressdetails', '1');
	searchUrl.searchParams.set('limit', '8');
	searchUrl.searchParams.set('countrycodes', 'in');

	const data = await fetchJson(searchUrl, NOMINATIM_HEADERS);
	return Array.isArray(data) ? data.map(parseNominatimSearchResult) : [];
}

async function reverseWithNominatim(latitude, longitude) {
	const reverseUrl = new URL('https://nominatim.openstreetmap.org/reverse');
	reverseUrl.searchParams.set('format', 'json');
	reverseUrl.searchParams.set('lat', String(latitude));
	reverseUrl.searchParams.set('lon', String(longitude));
	reverseUrl.searchParams.set('addressdetails', '1');

	const data = await fetchJson(reverseUrl, NOMINATIM_HEADERS);
	return { ...parseNominatimReverse(data), latitude, longitude };
}

function haversineDistance(originLat, originLng, destLat, destLng) {
	const toRad = (d) => (d * Math.PI) / 180;
	const R = 6371000;
	const dLat = toRad(destLat - originLat);
	const dLng = toRad(destLng - originLng);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(originLat)) * Math.cos(toRad(destLat)) * Math.sin(dLng / 2) ** 2;
	const distance_m = Math.round(2 * R * Math.asin(Math.sqrt(a)));
	return {
		distance_m,
		duration_s: Math.round((distance_m / 250) * 60), // ~15 km/h urban estimate
		provider: 'haversine',
	};
}

async function googleDistanceMatrix(originLat, originLng, destLat, destLng) {
	const apiKey = getGoogleMapsApiKey();
	const oLat = roundCoord(originLat, 4);
	const oLng = roundCoord(originLng, 4);
	const dLat = roundCoord(destLat, 4);
	const dLng = roundCoord(destLng, 4);
	const key = `matrix:${oLat},${oLng}:${dLat},${dLng}`;

	return cached(key, TTL.matrix, async () => {
		const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
		url.searchParams.set('origins', `${oLat},${oLng}`);
		url.searchParams.set('destinations', `${dLat},${dLng}`);
		url.searchParams.set('mode', 'driving');
		url.searchParams.set('region', 'in');
		url.searchParams.set('key', apiKey);
		const data = await fetchJson(url);
		const element = data?.rows?.[0]?.elements?.[0];
		if (element?.status === 'OK' && element.distance?.value != null) {
			return {
				distance_m: Number(element.distance.value),
				duration_s: Number(element.duration?.value || 0),
				provider: 'google_distance_matrix',
			};
		}
		throw new Error(element?.status || data.status || 'Distance Matrix failed');
	});
}

/**
 * Road distance.
 * options.purpose: 'quote' | 'tracking' | 'generic'
 * - quote → Google Matrix when key set (cached)
 * - tracking → haversine by default (Matrix burns $ on every poll)
 * MAPS_DISTANCE_MODE=google|haversine|auto overrides.
 */
export async function distanceMeters(originLat, originLng, destLat, destLng, options = {}) {
	const purpose = options.purpose || 'generic';
	const mode = distanceMode();
	const apiKey = getGoogleMapsApiKey();

	const useGoogle =
		apiKey &&
		(mode === 'google' ||
			(mode === 'auto' && purpose === 'quote') ||
			(mode !== 'haversine' && purpose === 'quote'));

	if (useGoogle) {
		try {
			return await googleDistanceMatrix(originLat, originLng, destLat, destLng);
		} catch (err) {
			console.warn('Distance Matrix failed, using haversine:', err.message);
		}
	}

	return haversineDistance(originLat, originLng, destLat, destLng);
}

export function getGeocodeProvider() {
	return getGoogleMapsApiKey() ? 'google' : 'nominatim';
}

export async function searchPlaces(query) {
	const trimmed = String(query ?? '').trim();
	if (trimmed.length < 3) return [];

	const cacheKey = `search:${trimmed.toLowerCase()}`;
	return cached(cacheKey, TTL.search, async () => {
		if (getGoogleMapsApiKey()) {
			try {
				return await searchWithGoogle(trimmed);
			} catch (error) {
				console.warn('Google place search failed, falling back to Nominatim:', error.message);
			}
		}
		return searchWithNominatim(trimmed);
	});
}

export async function reverseGeocode(latitude, longitude) {
	const lat = roundCoord(latitude, 4);
	const lng = roundCoord(longitude, 4);
	const cacheKey = `reverse:${lat},${lng}`;

	return cached(cacheKey, TTL.reverse, async () => {
		if (getGoogleMapsApiKey()) {
			try {
				return await reverseWithGoogle(lat, lng);
			} catch (error) {
				console.warn('Google reverse geocode failed, falling back to Nominatim:', error.message);
			}
		}
		return reverseWithNominatim(lat, lng);
	});
}

/**
 * Google Places Autocomplete — keep Google (user priority), cache + min length to cut spend.
 */
export async function placesAutocomplete(input, { lat, lng, sessionToken } = {}) {
	const trimmed = String(input ?? '').trim();
	if (trimmed.length < 3) return [];

	const apiKey = getGoogleMapsApiKey();
	if (!apiKey) {
		return searchPlaces(trimmed);
	}

	const roundLat = Number.isFinite(lat) ? roundCoord(lat, 2) : '';
	const roundLng = Number.isFinite(lng) ? roundCoord(lng, 2) : '';
	const cacheKey = `ac:${trimmed.toLowerCase()}:${roundLat},${roundLng}`;

	return cached(cacheKey, TTL.autocomplete, async () => {
		try {
			const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
			url.searchParams.set('input', trimmed);
			url.searchParams.set('components', 'country:in');
			url.searchParams.set('key', apiKey);
			if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
			if (Number.isFinite(lat) && Number.isFinite(lng)) {
				url.searchParams.set('location', `${lat},${lng}`);
				url.searchParams.set('radius', '30000');
			}

			const data = await fetchJson(url);
			if (data.status === 'ZERO_RESULTS') return [];
			if (data.status !== 'OK') {
				throw new Error(data.error_message || `Places autocomplete failed: ${data.status}`);
			}

			return (data.predictions ?? []).slice(0, 6).map((p) => ({
				id: p.place_id,
				label: p.structured_formatting?.main_text || p.description,
				subtitle: p.description,
				place_id: p.place_id,
				types: p.types || [],
			}));
		} catch (err) {
			console.warn('Places autocomplete failed, falling back to geocode search:', err.message);
			return searchPlaces(trimmed);
		}
	});
}

export async function placeDetails(placeId) {
	const apiKey = getGoogleMapsApiKey();
	if (!apiKey) {
		const err = new Error('GOOGLE_MAPS_API_KEY required for place details');
		err.status = 503;
		throw err;
	}

	const id = String(placeId || '').trim();
	return cached(`details:${id}`, TTL.details, async () => {
		const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
		url.searchParams.set('place_id', id);
		url.searchParams.set('fields', 'place_id,formatted_address,geometry,address_component,name');
		url.searchParams.set('key', apiKey);

		const data = await fetchJson(url);
		if (data.status !== 'OK' || !data.result) {
			throw new Error(data.error_message || `Place details failed: ${data.status}`);
		}

		const result = data.result;
		const lat = Number(result.geometry?.location?.lat);
		const lng = Number(result.geometry?.location?.lng);
		const parsed = parseGoogleGeocodeResult(
			{
				address_components: result.address_components,
				formatted_address: result.formatted_address,
			},
			lat,
			lng
		);

		return {
			place_id: result.place_id,
			name: result.name,
			...parsed,
			provider: 'google_places',
		};
	});
}
