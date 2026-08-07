/** Foundation: PostGIS, RBAC, geo, catalog spine, outbox, idempotency */
export const migration001 = {
	id: '001_foundation',
	async up(client) {
		await client.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
		await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS cities (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				state TEXT NOT NULL,
				region TEXT,
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				name TEXT,
				phone TEXT UNIQUE NOT NULL,
				email TEXT UNIQUE,
				password_hash TEXT,
				role TEXT NOT NULL DEFAULT 'customer'
					CHECK (role IN (
						'customer','vendor','delivery','regional_admin',
						'super_admin','support','field_agent'
					)),
				city_id INTEGER REFERENCES cities(id),
				otp_hash TEXT,
				otp_expires_at TIMESTAMPTZ,
				phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS refresh_tokens (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL UNIQUE,
				expires_at TIMESTAMPTZ NOT NULL,
				revoked_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS vendors (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
				business_name TEXT NOT NULL,
				vendor_type TEXT NOT NULL DEFAULT 'grocery',
				fulfillment_type TEXT NOT NULL DEFAULT 'prep_time'
					CHECK (fulfillment_type IN ('instant','prep_time','appointment')),
				catalog_kind TEXT NOT NULL DEFAULT 'product'
					CHECK (catalog_kind IN ('product','service')),
				city_id INTEGER REFERENCES cities(id),
				pincode TEXT,
				location GEOGRAPHY(POINT, 4326),
				coverage_radius_m INTEGER NOT NULL DEFAULT 3000,
				is_approved BOOLEAN NOT NULL DEFAULT FALSE,
				is_open BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS master_products (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				brand TEXT,
				barcode TEXT UNIQUE,
				category TEXT,
				unit_label TEXT,
				images JSONB NOT NULL DEFAULT '[]'::jsonb,
				search_vector TSVECTOR,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS master_products_name_trgm
			ON master_products USING GIN (name gin_trgm_ops)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS vendor_listings (
				id SERIAL PRIMARY KEY,
				vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
				master_product_id INTEGER NOT NULL REFERENCES master_products(id),
				price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
				mrp_paise INTEGER CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (vendor_id, master_product_id)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS vendor_inventory (
				id SERIAL PRIMARY KEY,
				vendor_listing_id INTEGER NOT NULL UNIQUE REFERENCES vendor_listings(id) ON DELETE CASCADE,
				qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
				reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CHECK (reserved_qty <= qty)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS addresses (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				label TEXT,
				street TEXT,
				house_details TEXT,
				landmark TEXT,
				area TEXT,
				pincode TEXT,
				city_id INTEGER REFERENCES cities(id),
				location GEOGRAPHY(POINT, 4326),
				is_default BOOLEAN NOT NULL DEFAULT FALSE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS orders (
				id SERIAL PRIMARY KEY,
				customer_id INTEGER NOT NULL REFERENCES users(id),
				vendor_id INTEGER NOT NULL REFERENCES vendors(id),
				status TEXT NOT NULL DEFAULT 'draft'
					CHECK (status IN (
						'draft','placed','accepted','preparing','ready',
						'picked','delivered','cancelled','rejected','expired','refunded','returned'
					)),
				fulfillment_type TEXT NOT NULL DEFAULT 'prep_time',
				total_paise INTEGER NOT NULL DEFAULT 0,
				delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
				payment_method TEXT,
				delivery_address_snapshot JSONB,
				idempotency_key TEXT,
				placed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_uidx
			ON orders (customer_id, idempotency_key)
			WHERE idempotency_key IS NOT NULL
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS order_items (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				vendor_listing_id INTEGER REFERENCES vendor_listings(id),
				master_product_id INTEGER,
				name_snapshot TEXT NOT NULL,
				unit_price_paise INTEGER NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				line_total_paise INTEGER NOT NULL
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS order_events (
				id BIGSERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				from_status TEXT,
				to_status TEXT NOT NULL,
				actor_user_id INTEGER REFERENCES users(id),
				meta JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS ledger_entries (
				id BIGSERIAL PRIMARY KEY,
				account_ref TEXT NOT NULL,
				direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
				amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
				reason TEXT NOT NULL,
				reference_type TEXT,
				reference_id TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS outbox (
				id BIGSERIAL PRIMARY KEY,
				event_type TEXT NOT NULL,
				event_version INTEGER NOT NULL DEFAULT 1,
				payload JSONB NOT NULL,
				aggregate_type TEXT,
				aggregate_id TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				published_at TIMESTAMPTZ
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
			ON outbox (id) WHERE published_at IS NULL
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS idempotency_keys (
				id BIGSERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				key TEXT NOT NULL,
				route TEXT NOT NULL,
				response_status INTEGER,
				response_body JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (user_id, key, route)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS devices (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expo_push_token TEXT NOT NULL,
				platform TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (user_id, expo_push_token)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS app_settings (
				key TEXT PRIMARY KEY,
				value JSONB NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
	},
};
