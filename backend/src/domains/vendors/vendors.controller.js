import pool from '../../db.js';
import { getVendorByUserId } from './vendor.helpers.js';

export async function getMe(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor profile not found' });
		return res.json({ vendor });
	} catch (err) {
		console.error('getMe', err);
		return res.status(500).json({ error: 'Failed to load vendor' });
	}
}

/**
 * Customer (or any user) applies to become a vendor.
 * body: { business_name, vendor_type?, fulfillment_type?, catalog_kind?,
 *         pincode?, lat, lng, coverage_radius_m?, fulfillment_mode_default?, city_id? }
 */
export async function apply(req, res) {
	const client = await pool.connect();
	try {
		const businessName = String(req.body.business_name || '').trim();
		const lat = Number(req.body.lat);
		const lng = Number(req.body.lng);
		if (!businessName) return res.status(400).json({ error: 'business_name required' });
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			return res.status(400).json({ error: 'lat and lng required' });
		}

		const existing = await getVendorByUserId(req.user.id, client);
		if (existing) {
			return res.status(409).json({ error: 'Vendor profile already exists', vendor: existing });
		}

		await client.query('BEGIN');
		await client.query(
			`UPDATE users SET role = 'vendor', city_id = COALESCE($2, city_id), updated_at = NOW()
			 WHERE id = $1`,
			[req.user.id, req.body.city_id || null]
		);

		const vendor = await client.query(
			`INSERT INTO vendors (
				user_id, business_name, vendor_type, fulfillment_type, catalog_kind,
				city_id, pincode, location, coverage_radius_m, is_approved, is_open,
				fulfillment_mode_default
			 ) VALUES (
				$1, $2, $3, $4, $5, $6, $7,
				ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
				$10, FALSE, TRUE, $11
			 )
			 RETURNING *`,
			[
				req.user.id,
				businessName,
				req.body.vendor_type || 'grocery',
				req.body.fulfillment_type || 'prep_time',
				req.body.catalog_kind || 'product',
				req.body.city_id || req.user.city_id || null,
				req.body.pincode || null,
				lng,
				lat,
				Number(req.body.coverage_radius_m) || 3000,
				['self', 'partner', 'either'].includes(req.body.fulfillment_mode_default)
					? req.body.fulfillment_mode_default
					: 'either',
			]
		);

		await client.query('COMMIT');
		return res.status(201).json({
			vendor: vendor.rows[0],
			message: 'Application submitted; pending admin approval',
		});
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('vendor.apply', err);
		return res.status(500).json({ error: 'Failed to apply as vendor' });
	} finally {
		client.release();
	}
}

/** PATCH vendor profile (open/closed, coverage, location, fulfillment prefs) */
export async function patchMe(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

		const fields = [];
		const values = [];
		let i = 1;

		if (req.body.business_name != null) {
			fields.push(`business_name = $${i++}`);
			values.push(String(req.body.business_name).trim());
		}
		if (req.body.is_open != null) {
			fields.push(`is_open = $${i++}`);
			values.push(Boolean(req.body.is_open));
		}
		if (req.body.coverage_radius_m != null) {
			const r = Number(req.body.coverage_radius_m);
			if (!Number.isInteger(r) || r < 100) {
				return res.status(400).json({ error: 'invalid coverage_radius_m' });
			}
			fields.push(`coverage_radius_m = $${i++}`);
			values.push(r);
		}
		if (req.body.fulfillment_mode_default != null) {
			if (!['self', 'partner', 'either'].includes(req.body.fulfillment_mode_default)) {
				return res.status(400).json({ error: 'invalid fulfillment_mode_default' });
			}
			fields.push(`fulfillment_mode_default = $${i++}`);
			values.push(req.body.fulfillment_mode_default);
		}
		if (req.body.pincode != null) {
			fields.push(`pincode = $${i++}`);
			values.push(String(req.body.pincode));
		}
		if (req.body.lat != null && req.body.lng != null) {
			const lat = Number(req.body.lat);
			const lng = Number(req.body.lng);
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
				return res.status(400).json({ error: 'invalid lat/lng' });
			}
			fields.push(`location = ST_SetSRID(ST_MakePoint($${i}, $${i + 1}), 4326)::geography`);
			values.push(lng, lat);
			i += 2;
		}

		if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

		values.push(vendor.id);
		const result = await pool.query(
			`UPDATE vendors SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
			values
		);
		return res.json({ vendor: result.rows[0] });
	} catch (err) {
		console.error('vendor.patchMe', err);
		return res.status(500).json({ error: 'Failed to update vendor' });
	}
}

export async function createProposal(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

		const name = String(req.body.name || '').trim();
		if (!name) return res.status(400).json({ error: 'name required' });

		const result = await pool.query(
			`INSERT INTO vendor_product_proposals (
				vendor_id, name, brand, barcode, category, unit_label, suggested_price_paise
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7)
			 RETURNING *`,
			[
				vendor.id,
				name,
				req.body.brand || null,
				req.body.barcode || null,
				req.body.category || null,
				req.body.unit_label || null,
				req.body.suggested_price_paise != null ? Number(req.body.suggested_price_paise) : null,
			]
		);
		return res.status(201).json({ proposal: result.rows[0] });
	} catch (err) {
		console.error('createProposal', err);
		return res.status(500).json({ error: 'Failed to create proposal' });
	}
}

export async function listMyProposals(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
		const result = await pool.query(
			`SELECT * FROM vendor_product_proposals WHERE vendor_id = $1 ORDER BY id DESC`,
			[vendor.id]
		);
		return res.json({ proposals: result.rows });
	} catch (err) {
		console.error('listMyProposals', err);
		return res.status(500).json({ error: 'Failed to list proposals' });
	}
}

export async function listMyListings(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

		const result = await pool.query(
			`SELECT
				vl.id,
				vl.price_paise,
				vl.mrp_paise,
				vl.is_active,
				vl.created_at,
				mp.id AS master_product_id,
				mp.name,
				mp.brand,
				mp.category,
				mp.unit_label,
				mp.barcode,
				COALESCE(vi.qty, 0) AS qty,
				COALESCE(vi.reserved_qty, 0) AS reserved_qty,
				COALESCE(vi.qty, 0) - COALESCE(vi.reserved_qty, 0) AS available_qty
			 FROM vendor_listings vl
			 JOIN master_products mp ON mp.id = vl.master_product_id
			 LEFT JOIN vendor_inventory vi ON vi.vendor_listing_id = vl.id
			 WHERE vl.vendor_id = $1
			 ORDER BY vl.created_at DESC`,
			[vendor.id]
		);

		return res.json({ vendor_id: vendor.id, listings: result.rows });
	} catch (err) {
		console.error('listMyListings', err);
		return res.status(500).json({ error: 'Failed to list listings' });
	}
}

export async function createListing(req, res) {
	const client = await pool.connect();
	try {
		const vendor = await getVendorByUserId(req.user.id, client);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
		if (!vendor.is_approved) return res.status(403).json({ error: 'Vendor pending approval' });

		const masterProductId = Number(req.body.master_product_id);
		const pricePaise = Number(req.body.price_paise);
		const mrpPaise = req.body.mrp_paise != null ? Number(req.body.mrp_paise) : null;
		const qty = req.body.qty != null ? Number(req.body.qty) : 0;

		if (!Number.isInteger(masterProductId) || masterProductId < 1) {
			return res.status(400).json({ error: 'master_product_id required' });
		}
		if (!Number.isInteger(pricePaise) || pricePaise < 0) {
			return res.status(400).json({ error: 'price_paise must be integer >= 0' });
		}
		if (!Number.isInteger(qty) || qty < 0) {
			return res.status(400).json({ error: 'qty must be integer >= 0' });
		}

		const product = await client.query('SELECT id FROM master_products WHERE id = $1', [masterProductId]);
		if (product.rowCount === 0) return res.status(404).json({ error: 'Master product not found' });

		await client.query('BEGIN');

		const listing = await client.query(
			`INSERT INTO vendor_listings (vendor_id, master_product_id, price_paise, mrp_paise)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (vendor_id, master_product_id)
			 DO UPDATE SET price_paise = EXCLUDED.price_paise,
			               mrp_paise = EXCLUDED.mrp_paise,
			               is_active = TRUE
			 RETURNING *`,
			[vendor.id, masterProductId, pricePaise, mrpPaise]
		);

		await client.query(
			`INSERT INTO vendor_inventory (vendor_listing_id, qty, reserved_qty)
			 VALUES ($1, $2, 0)
			 ON CONFLICT (vendor_listing_id)
			 DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
			[listing.rows[0].id, qty]
		);

		await client.query('COMMIT');
		return res.status(201).json({ listing: listing.rows[0], qty });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('createListing', err);
		return res.status(500).json({ error: 'Failed to create listing' });
	} finally {
		client.release();
	}
}

export async function updateListing(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

		const listingId = Number(req.params.id);
		const fields = [];
		const values = [];
		let i = 1;

		if (req.body.price_paise != null) {
			const price = Number(req.body.price_paise);
			if (!Number.isInteger(price) || price < 0) {
				return res.status(400).json({ error: 'invalid price_paise' });
			}
			fields.push(`price_paise = $${i++}`);
			values.push(price);
		}
		if (req.body.mrp_paise != null) {
			const mrp = Number(req.body.mrp_paise);
			if (!Number.isInteger(mrp) || mrp < 0) {
				return res.status(400).json({ error: 'invalid mrp_paise' });
			}
			fields.push(`mrp_paise = $${i++}`);
			values.push(mrp);
		}
		if (req.body.is_active != null) {
			fields.push(`is_active = $${i++}`);
			values.push(Boolean(req.body.is_active));
		}

		if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

		values.push(listingId, vendor.id);
		const result = await pool.query(
			`UPDATE vendor_listings
			 SET ${fields.join(', ')}
			 WHERE id = $${i++} AND vendor_id = $${i}
			 RETURNING *`,
			values
		);

		if (result.rowCount === 0) return res.status(404).json({ error: 'Listing not found' });
		return res.json({ listing: result.rows[0] });
	} catch (err) {
		console.error('updateListing', err);
		return res.status(500).json({ error: 'Failed to update listing' });
	}
}

export async function updateInventory(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

		const listingId = Number(req.params.id);
		const qty = Number(req.body.qty);
		if (!Number.isInteger(qty) || qty < 0) {
			return res.status(400).json({ error: 'qty must be integer >= 0' });
		}

		const owned = await pool.query(
			`SELECT vl.id, COALESCE(vi.reserved_qty, 0) AS reserved_qty
			 FROM vendor_listings vl
			 LEFT JOIN vendor_inventory vi ON vi.vendor_listing_id = vl.id
			 WHERE vl.id = $1 AND vl.vendor_id = $2`,
			[listingId, vendor.id]
		);
		if (owned.rowCount === 0) return res.status(404).json({ error: 'Listing not found' });

		const reserved = Number(owned.rows[0].reserved_qty);
		if (qty < reserved) {
			return res.status(400).json({
				error: `qty cannot be below reserved_qty (${reserved})`,
			});
		}

		const result = await pool.query(
			`INSERT INTO vendor_inventory (vendor_listing_id, qty, reserved_qty)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (vendor_listing_id)
			 DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()
			 RETURNING *`,
			[listingId, qty, reserved]
		);

		return res.json({ inventory: result.rows[0] });
	} catch (err) {
		console.error('updateInventory', err);
		return res.status(500).json({ error: 'Failed to update inventory' });
	}
}

export async function listVendorStorefront(req, res) {
	try {
		const vendorId = Number(req.params.vendorId);
		const result = await pool.query(
			`SELECT
				vl.id AS listing_id,
				vl.price_paise,
				vl.mrp_paise,
				mp.name,
				mp.brand,
				mp.unit_label,
				mp.category,
				COALESCE(vi.qty, 0) - COALESCE(vi.reserved_qty, 0) AS available_qty
			 FROM vendor_listings vl
			 JOIN vendors v ON v.id = vl.vendor_id
			 JOIN master_products mp ON mp.id = vl.master_product_id
			 LEFT JOIN vendor_inventory vi ON vi.vendor_listing_id = vl.id
			 WHERE vl.vendor_id = $1
			   AND vl.is_active = TRUE
			   AND v.is_approved = TRUE
			   AND v.is_open = TRUE
			 ORDER BY mp.name ASC`,
			[vendorId]
		);
		return res.json({ items: result.rows });
	} catch (err) {
		console.error('listVendorStorefront', err);
		return res.status(500).json({ error: 'Failed to load storefront' });
	}
}

export async function listOpenVendors(req, res) {
	try {
		const lat = req.query.lat != null ? Number(req.query.lat) : null;
		const lng = req.query.lng != null ? Number(req.query.lng) : null;
		const geo = Number.isFinite(lat) && Number.isFinite(lng);

		const result = geo
			? await pool.query(
					`SELECT
						v.id,
						v.business_name,
						v.vendor_type,
						v.fulfillment_type,
						v.fulfillment_mode_default,
						v.coverage_radius_m,
						ST_Distance(v.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
						COUNT(vl.id) FILTER (WHERE vl.is_active) AS listing_count
					 FROM vendors v
					 LEFT JOIN vendor_listings vl ON vl.vendor_id = v.id
					 WHERE v.is_approved = TRUE AND v.is_open = TRUE
					   AND v.location IS NOT NULL
					   AND ST_DWithin(
					     v.location,
					     ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
					     v.coverage_radius_m
					   )
					 GROUP BY v.id
					 ORDER BY distance_m ASC`,
					[lng, lat]
				)
			: await pool.query(
					`SELECT
						v.id,
						v.business_name,
						v.vendor_type,
						v.fulfillment_type,
						v.fulfillment_mode_default,
						v.coverage_radius_m,
						COUNT(vl.id) FILTER (WHERE vl.is_active) AS listing_count
					 FROM vendors v
					 LEFT JOIN vendor_listings vl ON vl.vendor_id = v.id
					 WHERE v.is_approved = TRUE AND v.is_open = TRUE
					 GROUP BY v.id
					 ORDER BY v.business_name ASC`
				);

		return res.json({ vendors: result.rows });
	} catch (err) {
		console.error('listOpenVendors', err);
		return res.status(500).json({ error: 'Failed to list vendors' });
	}
}
