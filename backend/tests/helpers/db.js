import dotenv from 'dotenv';
import pool from '../../src/db.js';
import { runMigrations } from '../../src/migrations/index.js';

dotenv.config();

export async function resetDb() {
	await runMigrations();
	await pool.query(`
		TRUNCATE
			notification_log,
			disputes,
			store_verifications,
			service_bookings,
			vendor_services,
			master_services,
			checkout_previews,
			order_group_orders,
			order_groups,
			refunds,
			commission_settlements,
			payments,
			delivery_jobs,
			delivery_partners,
			vendor_product_proposals,
			order_events,
			order_items,
			orders,
			shopping_list_items,
			shopping_list_members,
			shopping_lists,
			idempotency_keys,
			ledger_entries,
			outbox,
			vendor_inventory,
			vendor_listings,
			vendors,
			addresses,
			refresh_tokens,
			devices,
			users,
			master_products,
			cities,
			info_pages,
			app_settings
		RESTART IDENTITY CASCADE
	`);
	await pool.query(`
		INSERT INTO info_pages (slug, title, body)
		VALUES
			('privacy', 'Privacy Policy', 'Privacy policy placeholder.'),
			('terms', 'Terms of Service', 'Terms of service placeholder.'),
			('support', 'Support', 'Contact Grabit support.')
		ON CONFLICT (slug) DO NOTHING
	`);
}

export async function seedSplitFixture() {
	const city = await pool.query(
		`INSERT INTO cities (name, state, region) VALUES ('Demo Town', 'MH', 'West') RETURNING id`
	);
	const cityId = city.rows[0].id;

	const customer = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('Cust', '9111111111', 'customer', TRUE, $1) RETURNING id`,
		[cityId]
	);

	const v1user = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('V1', '9000000001', 'vendor', TRUE, $1) RETURNING id`,
		[cityId]
	);
	const v2user = await pool.query(
		`INSERT INTO users (name, phone, role, phone_verified, city_id)
		 VALUES ('V2', '9000000002', 'vendor', TRUE, $1) RETURNING id`,
		[cityId]
	);

	// ~19.0760, 72.8777 Mumbai-ish
	const v1 = await pool.query(
		`INSERT INTO vendors (user_id, business_name, vendor_type, city_id, pincode, location, coverage_radius_m, is_approved, is_open)
		 VALUES ($1, 'Ravi Kirana', 'grocery', $2, '400001',
		   ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography, 5000, TRUE, TRUE)
		 RETURNING id`,
		[v1user.rows[0].id, cityId]
	);
	const v2 = await pool.query(
		`INSERT INTO vendors (user_id, business_name, vendor_type, city_id, pincode, location, coverage_radius_m, is_approved, is_open)
		 VALUES ($1, 'Lakshmi Dairy', 'dairy', $2, '400002',
		   ST_SetSRID(ST_MakePoint(72.8800, 19.0780), 4326)::geography, 5000, TRUE, TRUE)
		 RETURNING id`,
		[v2user.rows[0].id, cityId]
	);

	const milk = await pool.query(
		`INSERT INTO master_products (name, brand, barcode, category, unit_label)
		 VALUES ('Amul Gold Milk', 'Amul', '8901262010010', 'Dairy', '500 ml') RETURNING id`
	);
	const salt = await pool.query(
		`INSERT INTO master_products (name, brand, barcode, category, unit_label)
		 VALUES ('Tata Salt', 'Tata', '8901042951510', 'Grocery', '1 kg') RETURNING id`
	);
	const incense = await pool.query(
		`INSERT INTO master_products (name, brand, barcode, category, unit_label)
		 VALUES ('Cycle Agarbatti', 'Cycle', '8901234567890', 'Pooja', '1 pack') RETURNING id`
	);

	async function listing(vendorId, masterId, price, qty) {
		const l = await pool.query(
			`INSERT INTO vendor_listings (vendor_id, master_product_id, price_paise, is_active)
			 VALUES ($1, $2, $3, TRUE) RETURNING id`,
			[vendorId, masterId, price]
		);
		await pool.query(
			`INSERT INTO vendor_inventory (vendor_listing_id, qty, reserved_qty) VALUES ($1, $2, 0)`,
			[l.rows[0].id, qty]
		);
		return l.rows[0].id;
	}

	// Vendor1: milk + salt
	await listing(v1.rows[0].id, milk.rows[0].id, 3300, 50);
	await listing(v1.rows[0].id, salt.rows[0].id, 2800, 50);
	// Vendor2: milk (cheaper) + incense only
	await listing(v2.rows[0].id, milk.rows[0].id, 3000, 50);
	await listing(v2.rows[0].id, incense.rows[0].id, 5000, 50);

	await pool.query(
		`INSERT INTO addresses (user_id, label, area, pincode, city_id, location, is_default)
		 VALUES ($1, 'Home', 'Andheri', '400001', $2,
		   ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography, TRUE)`,
		[customer.rows[0].id, cityId]
	);

	return {
		customerId: customer.rows[0].id,
		vendor1Id: v1.rows[0].id,
		vendor2Id: v2.rows[0].id,
		milkId: milk.rows[0].id,
		saltId: salt.rows[0].id,
		incenseId: incense.rows[0].id,
		lat: 19.0760,
		lng: 72.8777,
	};
}

export { pool };
