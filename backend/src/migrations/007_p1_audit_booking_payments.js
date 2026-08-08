/** P1: audit logs, booking payments, refund dispute link */
export const migration007 = {
	id: '007_p1_audit_booking_payments',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS audit_logs (
				id BIGSERIAL PRIMARY KEY,
				actor_user_id INTEGER REFERENCES users(id),
				action TEXT NOT NULL,
				entity_type TEXT,
				entity_id TEXT,
				meta JSONB NOT NULL DEFAULT '{}'::jsonb,
				ip TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id)
		`);

		await client.query(`
			ALTER TABLE service_bookings
			ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
				CHECK (payment_status IN ('unpaid','pending','paid','refunded','cod_pending'))
		`);
		await client.query(`
			ALTER TABLE service_bookings
			ADD COLUMN IF NOT EXISTS payment_method TEXT
		`);

		await client.query(`
			ALTER TABLE payments
			ALTER COLUMN order_id DROP NOT NULL
		`);
		await client.query(`
			ALTER TABLE payments
			ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES service_bookings(id) ON DELETE CASCADE
		`);
		await client.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_or_booking_chk'
				) THEN
					ALTER TABLE payments
					ADD CONSTRAINT payments_order_or_booking_chk
					CHECK (order_id IS NOT NULL OR booking_id IS NOT NULL);
				END IF;
			END $$;
		`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS payments_booking_provider_uidx
			ON payments (booking_id, provider)
			WHERE booking_id IS NOT NULL AND status NOT IN ('failed','refunded')
		`);

		await client.query(`
			ALTER TABLE refunds
			ALTER COLUMN order_id DROP NOT NULL
		`);
		await client.query(`
			ALTER TABLE refunds
			ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES service_bookings(id)
		`);
		await client.query(`
			ALTER TABLE refunds
			ADD COLUMN IF NOT EXISTS dispute_id INTEGER REFERENCES disputes(id)
		`);
	},
};
