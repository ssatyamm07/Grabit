/** Shopping lists, members, items, order groups for multi-vendor split checkout */
export const migration002 = {
	id: '002_shopping_lists',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS shopping_lists (
				id SERIAL PRIMARY KEY,
				owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
				name TEXT NOT NULL,
				list_type TEXT NOT NULL DEFAULT 'grocery'
					CHECK (list_type IN ('grocery','pooja','dairy','vegetables','custom')),
				status TEXT NOT NULL DEFAULT 'active'
					CHECK (status IN ('active','archived')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS shopping_lists_owner_idx
			ON shopping_lists (owner_user_id) WHERE status = 'active'
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS shopping_list_items (
				id SERIAL PRIMARY KEY,
				list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
				master_product_id INTEGER NOT NULL REFERENCES master_products(id),
				qty INTEGER NOT NULL CHECK (qty >= 1),
				notes TEXT,
				added_by INTEGER REFERENCES users(id),
				sort_order INTEGER NOT NULL DEFAULT 0,
				version INTEGER NOT NULL DEFAULT 1,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (list_id, master_product_id)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS shopping_list_members (
				id SERIAL PRIMARY KEY,
				list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (list_id, user_id)
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS shopping_list_members_user_idx
			ON shopping_list_members (user_id)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS order_groups (
				id SERIAL PRIMARY KEY,
				customer_id INTEGER NOT NULL REFERENCES users(id),
				list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL,
				idempotency_key TEXT,
				status TEXT NOT NULL DEFAULT 'placed'
					CHECK (status IN ('previewed','placed','partial_failed','cancelled')),
				strategy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
				preview_token_hash TEXT,
				subtotal_paise INTEGER NOT NULL DEFAULT 0,
				delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
				total_paise INTEGER NOT NULL DEFAULT 0,
				vendor_count INTEGER NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS order_groups_customer_idempotency_uidx
			ON order_groups (customer_id, idempotency_key)
			WHERE idempotency_key IS NOT NULL
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS order_group_orders (
				order_group_id INTEGER NOT NULL REFERENCES order_groups(id) ON DELETE CASCADE,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				PRIMARY KEY (order_group_id, order_id)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS checkout_previews (
				id SERIAL PRIMARY KEY,
				token_hash TEXT NOT NULL UNIQUE,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
				strategy_snapshot JSONB NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS order_group_id INTEGER REFERENCES order_groups(id) ON DELETE SET NULL
		`);

		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS shopping_list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL
		`);
	},
};
