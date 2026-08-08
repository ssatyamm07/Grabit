import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { request } from '../helpers/supertest-lite.js';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
import { expireStaleOrders } from '../../src/workers/order-expire.js';
import { resetRateLimitBuckets } from '../../src/middleware/rateLimit.js';

dotenv.config();

function token(user) {
	return jwt.sign(
		{ id: user.id, role: user.role, city_id: user.city_id, phone: user.phone },
		process.env.JWT_SECRET || 'test-secret',
		{ expiresIn: '1h' }
	);
}

describe('Production hardening — OTP limits, expire, health', () => {
	let app;
	let fx;
	let customer;
	let ct;
	let listingId;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.SHOW_OTP_IN_RESPONSE = 'true';
		process.env.OTP_DRY_RUN = 'true';
		process.env.NODE_ENV = 'test';
		process.env.OTP_RATE_MAX = '5';
		app = createApp();
		await resetDb();
		fx = await seedSplitFixture();
		customer = (await pool.query(`SELECT * FROM users WHERE phone = '9111111111'`)).rows[0];
		ct = token(customer);
		listingId = (
			await pool.query(`SELECT id FROM vendor_listings WHERE vendor_id = $1 LIMIT 1`, [
				fx.vendor1Id,
			])
		).rows[0].id;
	});

	it('GET /api/health reports database check', async () => {
		const res = await request(app).get('/api/health');
		assert.equal(res.status, 200);
		assert.equal(res.body.status, 'OK');
		assert.equal(res.body.checks.database.ok, true);
		assert.ok(typeof res.body.checks.outbox_backlog.unpublished === 'number');
	});

	it('send-otp is dry-run and rate-limited per phone', async () => {
		resetRateLimitBuckets();
		const phone = '9555555501';
		for (let i = 0; i < 5; i++) {
			const res = await request(app).post('/api/auth/send-otp').send({ phone });
			assert.equal(res.status, 200);
			assert.equal(res.body.delivery, 'dry_run');
			assert.ok(res.body.dev_otp);
		}
		const blocked = await request(app).post('/api/auth/send-otp').send({ phone });
		assert.equal(blocked.status, 429);
	});

	it('expireStaleOrders releases reserved stock', async () => {
		const beforeInv = await pool.query(
			`SELECT reserved_qty FROM vendor_inventory WHERE vendor_listing_id = $1`,
			[listingId]
		);
		const reservedBefore = Number(beforeInv.rows[0].reserved_qty);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `expire-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);
		const orderId = placed.body.order.id;

		const mid = await pool.query(
			`SELECT reserved_qty FROM vendor_inventory WHERE vendor_listing_id = $1`,
			[listingId]
		);
		assert.equal(Number(mid.rows[0].reserved_qty), reservedBefore + 1);

		await pool.query(
			`UPDATE orders SET created_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
			[orderId]
		);

		const result = await expireStaleOrders(pool, { ttlMinutes: 30, limit: 50 });
		assert.ok(result.expired >= 1);

		const order = await pool.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
		assert.equal(order.rows[0].status, 'expired');

		const after = await pool.query(
			`SELECT reserved_qty FROM vendor_inventory WHERE vendor_listing_id = $1`,
			[listingId]
		);
		assert.equal(Number(after.rows[0].reserved_qty), reservedBefore);
	});

	it('customer cancel also releases reserved stock', async () => {
		const beforeInv = await pool.query(
			`SELECT reserved_qty FROM vendor_inventory WHERE vendor_listing_id = $1`,
			[listingId]
		);
		const reservedBefore = Number(beforeInv.rows[0].reserved_qty);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `cancel-stock-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);

		const cancel = await request(app)
			.post(`/api/orders/${placed.body.order.id}/transition`)
			.set('Authorization', `Bearer ${ct}`)
			.send({ to_status: 'cancelled' });
		assert.equal(cancel.status, 200);
		assert.equal(cancel.body.order.status, 'cancelled');

		const after = await pool.query(
			`SELECT reserved_qty FROM vendor_inventory WHERE vendor_listing_id = $1`,
			[listingId]
		);
		assert.equal(Number(after.rows[0].reserved_qty), reservedBefore);
	});
});
