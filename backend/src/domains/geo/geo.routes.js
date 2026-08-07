import { Router } from 'express';
import pool from '../../db.js';

const router = Router();

/** Vendors that can serve a lat/lng within coverage radius (PostGIS) */
router.get('/serviceable', async (req, res) => {
	try {
		const lat = Number(req.query.lat);
		const lng = Number(req.query.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			return res.status(400).json({ error: 'lat and lng required' });
		}

		const result = await pool.query(
			`SELECT
				v.id,
				v.business_name,
				v.vendor_type,
				v.fulfillment_type,
				v.coverage_radius_m,
				ST_Distance(v.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
			 FROM vendors v
			 WHERE v.is_approved = TRUE
			   AND v.is_open = TRUE
			   AND v.location IS NOT NULL
			   AND ST_DWithin(
			     v.location,
			     ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
			     v.coverage_radius_m
			   )
			 ORDER BY distance_m ASC
			 LIMIT 50`,
			[lng, lat]
		);

		return res.json({ vendors: result.rows });
	} catch (err) {
		console.error('geo serviceable', err);
		return res.status(500).json({ error: 'Geo query failed' });
	}
});

export default router;
