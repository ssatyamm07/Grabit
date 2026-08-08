import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, getGeocodeProvider } from '../../src/domains/geo/geocode.service.js';

describe('geocode / distance', () => {
	it('reports provider based on GOOGLE_MAPS_API_KEY', () => {
		const prev = process.env.GOOGLE_MAPS_API_KEY;
		delete process.env.GOOGLE_MAPS_API_KEY;
		assert.equal(getGeocodeProvider(), 'nominatim');
		process.env.GOOGLE_MAPS_API_KEY = 'fake';
		assert.equal(getGeocodeProvider(), 'google');
		if (prev === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
		else process.env.GOOGLE_MAPS_API_KEY = prev;
	});

	it('haversine distance is positive between two Mumbai points', async () => {
		delete process.env.GOOGLE_MAPS_API_KEY;
		const d = await distanceMeters(19.076, 72.8777, 19.078, 72.88);
		assert.equal(d.provider, 'haversine');
		assert.ok(d.distance_m > 100 && d.distance_m < 5000);
	});
});
