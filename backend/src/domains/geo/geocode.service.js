import { parseNominatimReverse, parseNominatimSearchResult } from '../../utils/nominatim.js';
import { parseGoogleGeocodeResult, parseGoogleSearchResult } from '../../utils/googleGeocode.js';

const NOMINATIM_HEADERS = {
	'User-Agent': 'GrabitApp/1.0 (Contact: support@grabit.local)',
	Accept: 'application/json',
};
const GEOCODE_TIMEOUT_MS = 5000;

function getGoogleMapsApiKey() {
	return process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
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

/**
 * Road distance via Google Distance Matrix when key present; else haversine estimate.
 */
export async function distanceMeters(originLat, originLng, destLat, destLng) {
	const apiKey = getGoogleMapsApiKey();
	if (apiKey) {
		try {
			const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
			url.searchParams.set('origins', `${originLat},${originLng}`);
			url.searchParams.set('destinations', `${destLat},${destLng}`);
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
		} catch (err) {
			console.warn('Distance Matrix failed, using haversine:', err.message);
		}
	}

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

export function getGeocodeProvider() {
	return getGoogleMapsApiKey() ? 'google' : 'nominatim';
}

export async function searchPlaces(query) {
	const trimmed = String(query ?? '').trim();
	if (trimmed.length < 3) return [];

	if (getGoogleMapsApiKey()) {
		try {
			return await searchWithGoogle(trimmed);
		} catch (error) {
			console.warn('Google place search failed, falling back to Nominatim:', error.message);
		}
	}
	return searchWithNominatim(trimmed);
}

export async function reverseGeocode(latitude, longitude) {
	if (getGoogleMapsApiKey()) {
		try {
			return await reverseWithGoogle(latitude, longitude);
		} catch (error) {
			console.warn('Google reverse geocode failed, falling back to Nominatim:', error.message);
		}
	}
	return reverseWithNominatim(latitude, longitude);
}

/**
 * Google Places Autocomplete (New) — falls back to geocode search without key.
 * Maps SDK is client-side; this powers address autocomplete from the API.
 */
export async function placesAutocomplete(input, { lat, lng, sessionToken } = {}) {
	const trimmed = String(input ?? '').trim();
	if (trimmed.length < 2) return [];

	const apiKey = getGoogleMapsApiKey();
	if (!apiKey) {
		return searchPlaces(trimmed);
	}

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

		return (data.predictions ?? []).slice(0, 8).map((p) => ({
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
}

export async function placeDetails(placeId) {
	const apiKey = getGoogleMapsApiKey();
	if (!apiKey) {
		const err = new Error('GOOGLE_MAPS_API_KEY required for place details');
		err.status = 503;
		throw err;
	}

	const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
	url.searchParams.set('place_id', placeId);
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
}
