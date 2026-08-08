/** Reviews, analytics events, vendor name trigram search */
export const migration008 = {
	id: '008_reviews_search_analytics',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS reviews (
				id SERIAL PRIMARY KEY,
				customer_id INTEGER NOT NULL REFERENCES users(id),
				vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
				order_id INTEGER UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
				booking_id INTEGER UNIQUE REFERENCES service_bookings(id) ON DELETE CASCADE,
				rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
				body TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CHECK (order_id IS NOT NULL OR booking_id IS NOT NULL)
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS reviews_vendor_idx ON reviews (vendor_id, created_at DESC)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS analytics_events (
				id BIGSERIAL PRIMARY KEY,
				event_type TEXT NOT NULL,
				occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				city_id INTEGER REFERENCES cities(id),
				vendor_id INTEGER,
				order_id INTEGER,
				booking_id INTEGER,
				customer_id INTEGER,
				payload JSONB NOT NULL DEFAULT '{}'::jsonb,
				outbox_id BIGINT REFERENCES outbox(id)
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS analytics_events_type_time_idx
			ON analytics_events (event_type, occurred_at DESC)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS analytics_events_city_time_idx
			ON analytics_events (city_id, occurred_at DESC)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS analytics_daily (
				day DATE NOT NULL,
				city_id INTEGER NOT NULL DEFAULT 0,
				metric TEXT NOT NULL,
				value NUMERIC NOT NULL DEFAULT 0,
				PRIMARY KEY (day, metric, city_id)
			)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS vendors_business_name_trgm
			ON vendors USING GIN (business_name gin_trgm_ops)
		`);

		await client.query(`
			CREATE INDEX IF NOT EXISTS vendor_services_title_trgm
			ON vendor_services USING GIN (title gin_trgm_ops)
		`);

		await client.query(`
			UPDATE master_products
			SET search_vector =
				to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,''))
			WHERE search_vector IS NULL
		`);
	},
};
