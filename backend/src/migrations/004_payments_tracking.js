/** Payments, refunds, order tracking support */
export const migration004 = {
	id: '004_payments_tracking',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS payments (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				customer_id INTEGER NOT NULL REFERENCES users(id),
				provider TEXT NOT NULL DEFAULT 'cod'
					CHECK (provider IN ('cod','razorpay')),
				amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
				status TEXT NOT NULL DEFAULT 'created'
					CHECK (status IN ('created','pending','paid','failed','refunded','partial_refund')),
				razorpay_order_id TEXT,
				razorpay_payment_id TEXT,
				razorpay_signature TEXT,
				idempotency_key TEXT,
				meta JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS payments_order_provider_uidx
			ON payments (order_id, provider)
			WHERE status NOT IN ('failed','refunded')
		`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS payments_customer_idempotency_uidx
			ON payments (customer_id, idempotency_key)
			WHERE idempotency_key IS NOT NULL
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS refunds (
				id SERIAL PRIMARY KEY,
				payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
				reason TEXT,
				status TEXT NOT NULL DEFAULT 'processed'
					CHECK (status IN ('processed','failed')),
				created_by INTEGER REFERENCES users(id),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS commission_settlements (
				id SERIAL PRIMARY KEY,
				vendor_id INTEGER NOT NULL REFERENCES vendors(id),
				order_id INTEGER NOT NULL REFERENCES orders(id),
				order_total_paise INTEGER NOT NULL,
				commission_paise INTEGER NOT NULL,
				vendor_net_paise INTEGER NOT NULL,
				rate_bps INTEGER NOT NULL DEFAULT 1000,
				status TEXT NOT NULL DEFAULT 'settled'
					CHECK (status IN ('settled','reversed')),
				created_by INTEGER REFERENCES users(id),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (order_id)
			)
		`);

		await client.query(`
			ALTER TABLE orders
			ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
				CHECK (payment_status IN ('unpaid','pending','paid','refunded','cod_pending'))
		`);
	},
};
