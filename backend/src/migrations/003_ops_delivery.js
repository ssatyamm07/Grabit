/** Ops: fulfillment modes, delivery partners/jobs, proposals, info pages */
export const migration003 = {
	id: '003_ops_delivery',
	async up(client) {
		await client.query(`
			ALTER TABLE vendors
			ADD COLUMN IF NOT EXISTS fulfillment_mode_default TEXT NOT NULL DEFAULT 'either'
				CHECK (fulfillment_mode_default IN ('self','partner','either'))
		`);

		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT
				CHECK (fulfillment_mode IS NULL OR fulfillment_mode IN ('self','partner'))
		`);
		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS delivery_otp_hash TEXT
		`);
		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS delivery_otp_expires_at TIMESTAMPTZ
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS delivery_partners (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
				city_id INTEGER REFERENCES cities(id),
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				location GEOGRAPHY(POINT, 4326),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS delivery_jobs (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
				partner_id INTEGER REFERENCES delivery_partners(id),
				status TEXT NOT NULL DEFAULT 'unassigned'
					CHECK (status IN ('unassigned','assigned','picked_up','completed','cancelled')),
				assigned_at TIMESTAMPTZ,
				picked_up_at TIMESTAMPTZ,
				completed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS delivery_jobs_status_idx
			ON delivery_jobs (status)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS vendor_product_proposals (
				id SERIAL PRIMARY KEY,
				vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				brand TEXT,
				barcode TEXT,
				category TEXT,
				unit_label TEXT,
				suggested_price_paise INTEGER,
				status TEXT NOT NULL DEFAULT 'pending'
					CHECK (status IN ('pending','approved','rejected')),
				master_product_id INTEGER REFERENCES master_products(id),
				reviewed_by INTEGER REFERENCES users(id),
				reviewed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS info_pages (
				slug TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				body TEXT NOT NULL DEFAULT '',
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			INSERT INTO info_pages (slug, title, body)
			VALUES
				('privacy', 'Privacy Policy', 'Privacy policy placeholder.'),
				('terms', 'Terms of Service', 'Terms of service placeholder.'),
				('support', 'Support', 'Contact Grabit support.')
			ON CONFLICT (slug) DO NOTHING
		`);
	},
};
