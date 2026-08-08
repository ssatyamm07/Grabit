import dotenv from 'dotenv';
import pool from '../src/db.js';

dotenv.config();

async function ensureMaster(name, brand, barcode, category, unit) {
	if (barcode) {
		await pool.query(
			`INSERT INTO master_products (name, brand, barcode, category, unit_label)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (barcode) DO NOTHING`,
			[name, brand, barcode, category, unit]
		);
	} else {
		await pool.query(
			`INSERT INTO master_products (name, brand, barcode, category, unit_label)
			 SELECT $1, $2, NULL, $3, $4
			 WHERE NOT EXISTS (
			   SELECT 1 FROM master_products WHERE name = $1 AND brand = $2
			 )`,
			[name, brand, category, unit]
		);
	}
}

async function upsertVendor({ phone, name, businessName, vendorType, lng, lat, cityId }) {
	const vendorUser = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ($1, $2, 'vendor', TRUE, $3)
		 ON CONFLICT (phone) DO UPDATE
		   SET role = 'vendor', name = EXCLUDED.name, city_id = EXCLUDED.city_id
		 RETURNING id`,
		[name, phone, cityId]
	);

	const vendor = await pool.query(
		`INSERT INTO vendors (
			user_id, business_name, vendor_type, fulfillment_type, catalog_kind,
			city_id, pincode, location, coverage_radius_m, is_approved, is_open,
			fulfillment_mode_default
		 ) VALUES (
			$1, $2, $3, 'prep_time', 'product',
			$4, '400001',
			ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
			5000, TRUE, TRUE, 'either'
		 )
		 ON CONFLICT (user_id) DO UPDATE
		   SET is_approved = TRUE, is_open = TRUE, business_name = EXCLUDED.business_name,
		       location = EXCLUDED.location, vendor_type = EXCLUDED.vendor_type,
		       fulfillment_mode_default = COALESCE(vendors.fulfillment_mode_default, 'either')
		 RETURNING id`,
		[vendorUser.rows[0].id, businessName, vendorType, cityId, lng, lat]
	);
	return vendor.rows[0].id;
}

async function upsertListing(vendorId, masterId, pricePaise, qty = 50) {
	const listing = await pool.query(
		`INSERT INTO vendor_listings (vendor_id, master_product_id, price_paise, mrp_paise, is_active)
		 VALUES ($1, $2, $3, $4, TRUE)
		 ON CONFLICT (vendor_id, master_product_id)
		 DO UPDATE SET price_paise = EXCLUDED.price_paise, is_active = TRUE
		 RETURNING id`,
		[vendorId, masterId, pricePaise, Math.round(pricePaise * 1.1)]
	);
	await pool.query(
		`INSERT INTO vendor_inventory (vendor_listing_id, qty, reserved_qty)
		 VALUES ($1, $2, 0)
		 ON CONFLICT (vendor_listing_id)
		 DO UPDATE SET qty = $2, reserved_qty = 0, updated_at = NOW()`,
		[listing.rows[0].id, qty]
	);
}

async function seed() {
	const city = await pool.query(
		`INSERT INTO cities (name, state, region)
		 VALUES ('Demo Town', 'Maharashtra', 'West')
		 ON CONFLICT DO NOTHING
		 RETURNING id`
	);

	let cityId = city.rows[0]?.id;
	if (!cityId) {
		const existing = await pool.query(`SELECT id FROM cities WHERE name = 'Demo Town' LIMIT 1`);
		cityId = existing.rows[0]?.id;
	}

	const products = [
		['Amul Gold Milk', 'Amul', '8901262010010', 'Dairy', '500 ml'],
		['Britannia Bread', 'Britannia', '8901063092010', 'Bakery', '400 g'],
		['Tata Salt', 'Tata', '8901042951510', 'Grocery', '1 kg'],
		['Notebook A4', 'Classmate', null, 'Stationery', '172 pages'],
		['Cycle Agarbatti', 'Cycle', '8901234567890', 'Pooja', '1 pack'],
		['Camphor Tablets', 'Local', '8901234567891', 'Pooja', '50 g'],
		['Tomato', 'Fresh', '8901234567892', 'Vegetables', '1 kg'],
	];

	for (const row of products) {
		await ensureMaster(...row);
	}

	await pool.query(
		`INSERT INTO app_settings (key, value)
		 VALUES
		   ('brand', '{"name":"Grabit","colors":{"blue":"#1B6CA8","yellow":"#F5C518","green":"#2E8B57"}}'::jsonb),
		   ('delivery', '{"min_fee_paise":2000,"radius_m":3000}'::jsonb)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
	);

	const vendor1Id = await upsertVendor({
		phone: '9000000001',
		name: 'Ravi Kirana',
		businessName: 'Ravi Kirana Store',
		vendorType: 'grocery',
		lng: 72.8777,
		lat: 19.076,
		cityId,
	});

	const vendor2Id = await upsertVendor({
		phone: '9000000002',
		name: 'Lakshmi Dairy',
		businessName: 'Lakshmi Dairy & Pooja',
		vendorType: 'dairy',
		lng: 72.88,
		lat: 19.078,
		cityId,
	});

	const masters = await pool.query(`SELECT id, name FROM master_products`);
	const byName = Object.fromEntries(masters.rows.map((m) => [m.name, m.id]));

	// Vendor 1 — grocery staples
	await upsertListing(vendor1Id, byName['Amul Gold Milk'], 3300);
	await upsertListing(vendor1Id, byName['Britannia Bread'], 4500);
	await upsertListing(vendor1Id, byName['Tata Salt'], 2800);
	await upsertListing(vendor1Id, byName['Notebook A4'], 6000);
	await upsertListing(vendor1Id, byName['Tomato'], 4000);

	// Vendor 2 — dairy + pooja (+ cheaper milk)
	await upsertListing(vendor2Id, byName['Amul Gold Milk'], 3000);
	await upsertListing(vendor2Id, byName['Cycle Agarbatti'], 5000);
	await upsertListing(vendor2Id, byName['Camphor Tablets'], 3500);

	const customer = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('Demo Customer', '9111111111', 'customer', TRUE, $1)
		 ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, city_id = EXCLUDED.city_id
		 RETURNING id`,
		[cityId]
	);
	const customerId = customer.rows[0].id;

	await pool.query(
		`INSERT INTO addresses (user_id, label, area, pincode, city_id, location, is_default)
		 SELECT $1, 'Home', 'Andheri', '400001', $2,
		   ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography, TRUE
		 WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1 AND label = 'Home')`,
		[customerId, cityId]
	);

	// Sample shopping lists
	const grocery = await pool.query(
		`INSERT INTO shopping_lists (owner_user_id, name, list_type)
		 SELECT $1, 'Weekly grocery', 'grocery'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM shopping_lists WHERE owner_user_id = $1 AND name = 'Weekly grocery'
		 )
		 RETURNING id`,
		[customerId]
	);
	let groceryId = grocery.rows[0]?.id;
	if (!groceryId) {
		const existing = await pool.query(
			`SELECT id FROM shopping_lists WHERE owner_user_id = $1 AND name = 'Weekly grocery'`,
			[customerId]
		);
		groceryId = existing.rows[0]?.id;
	}

	await pool.query(
		`INSERT INTO shopping_list_members (list_id, user_id, role)
		 VALUES ($1, $2, 'owner')
		 ON CONFLICT DO NOTHING`,
		[groceryId, customerId]
	);

	for (const [masterId, qty] of [
		[byName['Tata Salt'], 1],
		[byName['Amul Gold Milk'], 2],
		[byName['Tomato'], 1],
	]) {
		if (!masterId) continue;
		await pool.query(
			`INSERT INTO shopping_list_items (list_id, master_product_id, qty, added_by)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (list_id, master_product_id) DO UPDATE SET qty = EXCLUDED.qty`,
			[groceryId, masterId, qty, customerId]
		);
	}

	const pooja = await pool.query(
		`INSERT INTO shopping_lists (owner_user_id, name, list_type)
		 SELECT $1, 'Pooja essentials', 'pooja'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM shopping_lists WHERE owner_user_id = $1 AND name = 'Pooja essentials'
		 )
		 RETURNING id`,
		[customerId]
	);
	let poojaId = pooja.rows[0]?.id;
	if (!poojaId) {
		const existing = await pool.query(
			`SELECT id FROM shopping_lists WHERE owner_user_id = $1 AND name = 'Pooja essentials'`,
			[customerId]
		);
		poojaId = existing.rows[0]?.id;
	}
	await pool.query(
		`INSERT INTO shopping_list_members (list_id, user_id, role)
		 VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
		[poojaId, customerId]
	);
	for (const masterId of [byName['Cycle Agarbatti'], byName['Camphor Tablets']]) {
		if (!masterId) continue;
		await pool.query(
			`INSERT INTO shopping_list_items (list_id, master_product_id, qty, added_by)
			 VALUES ($1, $2, 1, $3)
			 ON CONFLICT (list_id, master_product_id) DO UPDATE SET qty = 1`,
			[poojaId, masterId, customerId]
		);
	}

	await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('Demo Admin', '9000000099', 'super_admin', TRUE, $1)
		 ON CONFLICT (phone) DO UPDATE
		   SET role = 'super_admin', name = EXCLUDED.name, city_id = EXCLUDED.city_id`,
		[cityId]
	);

	const deliveryUser = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('Demo Rider', '9000000088', 'delivery', TRUE, $1)
		 ON CONFLICT (phone) DO UPDATE
		   SET role = 'delivery', name = EXCLUDED.name, city_id = EXCLUDED.city_id
		 RETURNING id`,
		[cityId]
	);
	await pool.query(
		`INSERT INTO delivery_partners (user_id, city_id, is_active)
		 VALUES ($1, $2, TRUE)
		 ON CONFLICT (user_id) DO UPDATE SET is_active = TRUE, city_id = EXCLUDED.city_id`,
		[deliveryUser.rows[0].id, cityId]
	);

	await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('Regional Admin', '9000000077', 'regional_admin', TRUE, $1)
		 ON CONFLICT (phone) DO UPDATE
		   SET role = 'regional_admin', name = EXCLUDED.name, city_id = EXCLUDED.city_id`,
		[cityId]
	);

	console.log('Seed complete', {
		cityId,
		vendors: {
			ravi: { id: vendor1Id, phone: '9000000001' },
			lakshmi: { id: vendor2Id, phone: '9000000002' },
		},
		customerPhone: '9111111111',
		adminPhone: '9000000099',
		deliveryPhone: '9000000088',
		lists: { groceryId, poojaId },
		hint: 'Customer 9111111111 · Vendors 9000000001/02 · Admin 9000000099 · Delivery 9000000088',
	});
	await pool.end();
}

seed().catch(async (err) => {
	console.error(err);
	await pool.end();
	process.exit(1);
});
