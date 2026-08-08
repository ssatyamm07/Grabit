import * as svc from './addresses.service.js';

export async function list(req, res) {
	try {
		const addresses = await svc.listAddresses(req.user.id);
		return res.json({ addresses });
	} catch (err) {
		console.error('addresses.list', err);
		return res.status(500).json({ error: 'Failed to list addresses' });
	}
}

export async function get(req, res) {
	try {
		const address = await svc.getAddress(req.user.id, Number(req.params.id));
		if (!address) return res.status(404).json({ error: 'Address not found' });
		return res.json({ address });
	} catch (err) {
		console.error('addresses.get', err);
		return res.status(500).json({ error: 'Failed to load address' });
	}
}

export async function create(req, res) {
	try {
		const address = await svc.createAddress(req.user.id, req.body);
		return res.status(201).json({ address });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.create', err);
		return res.status(500).json({ error: 'Failed to create address' });
	}
}

export async function update(req, res) {
	try {
		const address = await svc.updateAddress(req.user.id, Number(req.params.id), req.body);
		return res.json({ address });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.update', err);
		return res.status(500).json({ error: 'Failed to update address' });
	}
}

export async function remove(req, res) {
	try {
		await svc.deleteAddress(req.user.id, Number(req.params.id));
		return res.json({ ok: true });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.remove', err);
		return res.status(500).json({ error: 'Failed to delete address' });
	}
}

export async function setDefault(req, res) {
	try {
		const address = await svc.setDefaultAddress(req.user.id, Number(req.params.id));
		return res.json({ address });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.setDefault', err);
		return res.status(500).json({ error: 'Failed to set default' });
	}
}

export async function geocodeSearch(req, res) {
	try {
		const { searchPlaces, getGeocodeProvider } = await import('../geo/geocode.service.js');
		const results = await searchPlaces(req.query.q);
		return res.json({ results, provider: getGeocodeProvider() });
	} catch (err) {
		console.error('geocodeSearch', err);
		return res.status(500).json({ error: 'Failed to search places' });
	}
}

export async function geocodeReverse(req, res) {
	try {
		const lat = Number(req.query.lat);
		const lon = Number(req.query.lon ?? req.query.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
			return res.status(400).json({ error: 'lat and lon required' });
		}
		if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
			return res.status(400).json({ error: 'Invalid coordinates' });
		}
		const { reverseGeocode, getGeocodeProvider } = await import('../geo/geocode.service.js');
		const parsed = await reverseGeocode(lat, lon);
		return res.json({ ...parsed, provider: getGeocodeProvider() });
	} catch (err) {
		console.error('geocodeReverse', err);
		return res.status(500).json({ error: err.message || 'Failed to reverse geocode' });
	}
}

export async function placesAutocomplete(req, res) {
	try {
		const { placesAutocomplete: search, getGeocodeProvider } = await import(
			'../geo/geocode.service.js'
		);
		const results = await search(req.query.q || req.query.input, {
			lat: req.query.lat != null ? Number(req.query.lat) : undefined,
			lng: req.query.lng != null ? Number(req.query.lng) : undefined,
			sessionToken: req.query.session_token,
		});
		return res.json({ results, provider: getGeocodeProvider() });
	} catch (err) {
		console.error('placesAutocomplete', err);
		return res.status(500).json({ error: 'Failed to autocomplete places' });
	}
}

export async function placeDetails(req, res) {
	try {
		const placeId = String(req.params.placeId || req.query.place_id || '');
		if (!placeId) return res.status(400).json({ error: 'place_id required' });
		const { placeDetails: details } = await import('../geo/geocode.service.js');
		const place = await details(placeId);
		return res.json({ place });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('placeDetails', err);
		return res.status(500).json({ error: err.message || 'Failed to load place' });
	}
}
