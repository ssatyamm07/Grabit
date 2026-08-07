import pool from '../../db.js';
import { getVendorByUserId } from './vendor.helpers.js';

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

/** POST body: { master_product_id, price_paise, mrp_paise?, qty? } */
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

/** PATCH body: { price_paise?, mrp_paise?, is_active? } */
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

/** PATCH body: { qty } — absolute stock set (not reserved) */
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

/** Public: listings for a vendor (customer browse) */
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

/** Public: nearby / all open vendors with listing counts (pilot: all approved) */
export async function listOpenVendors(_req, res) {
	try {
		const result = await pool.query(
			`SELECT
				v.id,
				v.business_name,
				v.vendor_type,
				v.fulfillment_type,
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
