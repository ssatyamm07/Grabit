/** Disputes, field-agent store verification, service bookings, outbox consumer logs */
export const migration005 = {
	id: '005_disputes_services_outbox',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS disputes (
				id SERIAL PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
				opened_by INTEGER NOT NULL REFERENCES users(id),
				against_role TEXT NOT NULL DEFAULT 'vendor'
					CHECK (against_role IN ('vendor','customer','delivery','platform')),
				reason TEXT NOT NULL,
				details TEXT,
				status TEXT NOT NULL DEFAULT 'open'
					CHECK (status IN ('open','in_review','resolved','rejected','escalated')),
				resolution TEXT,
				resolved_by INTEGER REFERENCES users(id),
				resolved_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS disputes_order_idx ON disputes (order_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status)
		`);

		await client.query(`
			ALTER TABLE vendors
			ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
				CHECK (verification_status IN ('unverified','pending','verified','rejected'))
		`);
		await client.query(`
			ALTER TABLE vendors
			ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ
		`);
		await client.query(`
			ALTER TABLE vendors
			ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES users(id)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS store_verifications (
				id SERIAL PRIMARY KEY,
				vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
				field_agent_id INTEGER NOT NULL REFERENCES users(id),
				status TEXT NOT NULL DEFAULT 'scheduled'
					CHECK (status IN ('scheduled','in_progress','passed','failed','cancelled')),
				checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
				notes TEXT,
				photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
				scheduled_at TIMESTAMPTZ,
				completed_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS store_verifications_vendor_idx ON store_verifications (vendor_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS store_verifications_agent_idx ON store_verifications (field_agent_id)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS master_services (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				category TEXT,
				description TEXT,
				unit_label TEXT DEFAULT 'visit',
				images JSONB NOT NULL DEFAULT '[]'::jsonb,
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS vendor_services (
				id SERIAL PRIMARY KEY,
				vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
				master_service_id INTEGER REFERENCES master_services(id),
				title TEXT NOT NULL,
				description TEXT,
				price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
				duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (vendor_id, title)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS service_bookings (
				id SERIAL PRIMARY KEY,
				customer_id INTEGER NOT NULL REFERENCES users(id),
				vendor_id INTEGER NOT NULL REFERENCES vendors(id),
				vendor_service_id INTEGER NOT NULL REFERENCES vendor_services(id),
				status TEXT NOT NULL DEFAULT 'requested'
					CHECK (status IN (
						'requested','accepted','rejected','in_progress',
						'completed','cancelled','no_show'
					)),
				scheduled_start TIMESTAMPTZ NOT NULL,
				scheduled_end TIMESTAMPTZ,
				address_snapshot JSONB,
				price_paise INTEGER NOT NULL,
				notes TEXT,
				idempotency_key TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_customer_idempotency_uidx
			ON service_bookings (customer_id, idempotency_key)
			WHERE idempotency_key IS NOT NULL
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS service_bookings_vendor_idx ON service_bookings (vendor_id, status)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS notification_log (
				id BIGSERIAL PRIMARY KEY,
				channel TEXT NOT NULL CHECK (channel IN ('push','sms','email')),
				user_id INTEGER REFERENCES users(id),
				phone TEXT,
				title TEXT,
				body TEXT,
				event_type TEXT,
				outbox_id BIGINT REFERENCES outbox(id),
				status TEXT NOT NULL DEFAULT 'sent'
					CHECK (status IN ('sent','dry_run','failed','skipped')),
				provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		await client.query(`
			ALTER TABLE outbox
			ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0
		`);
		await client.query(`
			ALTER TABLE outbox
			ADD COLUMN IF NOT EXISTS last_error TEXT
		`);
	},
};
