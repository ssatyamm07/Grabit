import pool from '../../db.js';

/**
 * Unified search: products (trgm + barcode), vendors (name + geo), services.
 * GET /api/search?q=&lat=&lng=&limit=
 */
export async function unifiedSearch(req, res) {
	try {
		const q = String(req.query.q || '').trim();
		const limit = Math.min(Number(req.query.limit) || 20, 40);
		const lat = req.query.lat != null ? Number(req.query.lat) : null;
		const lng = req.query.lng != null ? Number(req.query.lng) : null;
		const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);

		if (!q || q.length < 1) {
			return res.json({ products: [], vendors: [], services: [], q });
		}

		const products = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images,
			        similarity(name, $1) AS score
			 FROM master_products
			 WHERE name % $1
			    OR brand ILIKE '%' || $1 || '%'
			    OR barcode = $1
			    OR name ILIKE '%' || $1 || '%'
			 ORDER BY
			   CASE WHEN barcode = $1 THEN 0 ELSE 1 END,
			   similarity(name, $1) DESC,
			   name ASC
			 LIMIT $2`,
			[q, limit]
		);

		let vendors;
		if (hasGeo) {
			vendors = await pool.query(
				`SELECT v.id, v.business_name, v.vendor_type, v.is_open, v.pincode,
				        ST_Y(v.location::geometry) AS lat,
				        ST_X(v.location::geometry) AS lng,
				        ST_Distance(
				          v.location,
				          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
				        ) AS distance_m,
				        similarity(v.business_name, $1) AS score,
				        COALESCE(AVG(r.rating), 0) AS avg_rating,
				        COUNT(r.id)::int AS review_count
				 FROM vendors v
				 LEFT JOIN reviews r ON r.vendor_id = v.id
				 WHERE v.is_approved = TRUE
				   AND (
				     v.business_name % $1
				     OR v.business_name ILIKE '%' || $1 || '%'
				     OR v.vendor_type ILIKE '%' || $1 || '%'
				   )
				   AND ST_DWithin(
				     v.location,
				     ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
				     COALESCE(v.coverage_radius_m, 5000)
				   )
				 GROUP BY v.id
				 ORDER BY score DESC, distance_m ASC
				 LIMIT $4`,
				[q, lng, lat, limit]
			);
		} else {
			vendors = await pool.query(
				`SELECT v.id, v.business_name, v.vendor_type, v.is_open, v.pincode,
				        similarity(v.business_name, $1) AS score,
				        COALESCE(AVG(r.rating), 0) AS avg_rating,
				        COUNT(r.id)::int AS review_count
				 FROM vendors v
				 LEFT JOIN reviews r ON r.vendor_id = v.id
				 WHERE v.is_approved = TRUE
				   AND (
				     v.business_name % $1
				     OR v.business_name ILIKE '%' || $1 || '%'
				     OR v.vendor_type ILIKE '%' || $1 || '%'
				   )
				 GROUP BY v.id
				 ORDER BY score DESC, v.business_name ASC
				 LIMIT $2`,
				[q, limit]
			);
		}

		const services = await pool.query(
			`SELECT vs.id, vs.title, vs.price_paise, vs.duration_minutes, vs.vendor_id,
			        v.business_name,
			        similarity(vs.title, $1) AS score
			 FROM vendor_services vs
			 JOIN vendors v ON v.id = vs.vendor_id
			 WHERE vs.is_active = TRUE AND v.is_approved = TRUE
			   AND (vs.title % $1 OR vs.title ILIKE '%' || $1 || '%' OR vs.description ILIKE '%' || $1 || '%')
			 ORDER BY score DESC, vs.title ASC
			 LIMIT $2`,
			[q, limit]
		);

		return res.json({
			q,
			products: products.rows,
			vendors: vendors.rows,
			services: services.rows,
		});
	} catch (err) {
		console.error('unifiedSearch', err);
		return res.status(500).json({ error: 'Search failed' });
	}
}
