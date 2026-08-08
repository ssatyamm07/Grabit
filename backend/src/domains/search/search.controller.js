import pool from '../../db.js';

async function expandQueryTerms(q) {
	const base = String(q || '').trim().toLowerCase();
	if (!base) return [];
	const terms = new Set([base]);
	try {
		const syn = await pool.query(
			`SELECT synonym AS alt FROM search_synonyms WHERE lower(term) = $1
			 UNION
			 SELECT term AS alt FROM search_synonyms WHERE lower(synonym) = $1`,
			[base]
		);
		for (const row of syn.rows) {
			if (row.alt) terms.add(String(row.alt).toLowerCase());
		}
	} catch {
		/* table may not exist yet during boot race */
	}
	return [...terms];
}

/**
 * Unified search: products (trgm + barcode + synonyms), vendors, services.
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
			return res.json({ products: [], vendors: [], services: [], q, terms: [] });
		}

		const terms = await expandQueryTerms(q);
		const primary = terms[0] || q.toLowerCase();

		const products = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images,
			        similarity(name, $1) AS score
			 FROM master_products
			 WHERE EXISTS (
			         SELECT 1 FROM unnest($3::text[]) t
			         WHERE name % t
			            OR brand ILIKE '%' || t || '%'
			            OR barcode = t
			            OR name ILIKE '%' || t || '%'
			       )
			 ORDER BY
			   CASE WHEN barcode = ANY($3::text[]) THEN 0 ELSE 1 END,
			   similarity(name, $1) DESC,
			   name ASC
			 LIMIT $2`,
			[primary, limit, terms]
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
				   AND EXISTS (
				     SELECT 1 FROM unnest($5::text[]) t
				     WHERE v.business_name % t
				        OR v.business_name ILIKE '%' || t || '%'
				        OR v.vendor_type ILIKE '%' || t || '%'
				   )
				   AND ST_DWithin(
				     v.location,
				     ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
				     COALESCE(v.coverage_radius_m, 5000)
				   )
				 GROUP BY v.id
				 ORDER BY score DESC, distance_m ASC
				 LIMIT $4`,
				[primary, lng, lat, limit, terms]
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
				   AND EXISTS (
				     SELECT 1 FROM unnest($3::text[]) t
				     WHERE v.business_name % t
				        OR v.business_name ILIKE '%' || t || '%'
				        OR v.vendor_type ILIKE '%' || t || '%'
				   )
				 GROUP BY v.id
				 ORDER BY score DESC, v.business_name ASC
				 LIMIT $2`,
				[primary, limit, terms]
			);
		}

		const services = await pool.query(
			`SELECT vs.id, vs.title, vs.price_paise, vs.duration_minutes, vs.vendor_id,
			        v.business_name,
			        similarity(vs.title, $1) AS score
			 FROM vendor_services vs
			 JOIN vendors v ON v.id = vs.vendor_id
			 WHERE vs.is_active = TRUE AND v.is_approved = TRUE
			   AND EXISTS (
			     SELECT 1 FROM unnest($3::text[]) t
			     WHERE vs.title % t
			        OR vs.title ILIKE '%' || t || '%'
			        OR COALESCE(vs.description, '') ILIKE '%' || t || '%'
			   )
			 ORDER BY score DESC, vs.title ASC
			 LIMIT $2`,
			[primary, limit, terms]
		);

		return res.json({
			q,
			terms,
			products: products.rows,
			vendors: vendors.rows,
			services: services.rows,
		});
	} catch (err) {
		console.error('unifiedSearch', err);
		return res.status(500).json({ error: 'Search failed' });
	}
}
