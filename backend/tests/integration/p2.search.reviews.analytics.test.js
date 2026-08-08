/**
 * P2: reviews, unified search, analytics, redis health
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { request } from '../helpers/supertest-lite.js';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
import { drainOnce } from '../../scripts/outbox-relay.js';
import { pingRedis } from '../../src/config/redis.js';

dotenv.config();

function token(user) {
	return jwt.sign(
		{ id: user.id, role: user.role, city_id: user.city_id, phone: user.phone },
		process.env.JWT_SECRET || 'test-secret',
		{ expiresIn: '1h' }
	);
}

describe('P2 reviews / search / analytics', () => {
	let app;
	let fx;
	let customer;
	let admin;
	let ct;
	let at;
	let listingId;
	let orderId;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.NODE_ENV = 'test';
		process.env.REDIS_DISABLED = 'true';
		app = createApp();
		await resetDb();
		fx = await seedSplitFixture();
		customer = (await pool.query(`SELECT * FROM users WHERE phone = '9111111111'`)).rows[0];
		admin = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Admin', '9000000099', 'super_admin', TRUE, $1) RETURNING *`,
				[customer.city_id]
			)
		).rows[0];
		listingId = (
			await pool.query(`SELECT id FROM vendor_listings WHERE vendor_id = $1 LIMIT 1`, [
				fx.vendor1Id,
			])
		).rows[0].id;
		ct = token(customer);
		at = token(admin);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `p2-ord-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);
		orderId = placed.body.order.id;
		await pool.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [orderId]);
	});

	it('creates and lists vendor reviews', async () => {
		const create = await request(app)
			.post('/api/reviews')
			.set('Authorization', `Bearer ${ct}`)
			.send({ order_id: orderId, rating: 5, body: 'Fresh milk, fast' });
		assert.equal(create.status, 201);
		assert.equal(create.body.review.rating, 5);

		const list = await request(app).get(`/api/reviews/vendor/${fx.vendor1Id}`);
		assert.equal(list.status, 200);
		assert.ok(list.body.summary.count >= 1);
		assert.equal(list.body.summary.avg_rating, 5);
	});

	it('unified search finds products and vendors', async () => {
		const products = await request(app).get(`/api/search?q=Amul&lat=${fx.lat}&lng=${fx.lng}`);
		assert.equal(products.status, 200);
		assert.ok(products.body.products.length >= 1);

		const vendors = await request(app).get(
			`/api/search?q=Kirana&lat=${fx.lat}&lng=${fx.lng}`
		);
		assert.equal(vendors.status, 200);
		assert.ok(vendors.body.vendors.length >= 1);
	});

	it('outbox drain writes analytics and pilot metrics work', async () => {
		await drainOnce(pool);
		const events = await pool.query(`SELECT COUNT(*)::int AS n FROM analytics_events`);
		assert.ok(events.rows[0].n >= 1);

		const pilot = await request(app)
			.get('/api/analytics/pilot?days=14')
			.set('Authorization', `Bearer ${at}`);
		assert.equal(pilot.status, 200);
		assert.ok(pilot.body.metrics);
		assert.ok(Array.isArray(pilot.body.daily));
	});

	it('health reports redis check when disabled', async () => {
		const ping = await pingRedis();
		assert.equal(ping.ok, false);
		const health = await request(app).get('/api/health');
		assert.equal(health.status, 200);
		assert.equal(health.body.checks.redis.ok, false);
	});
});
