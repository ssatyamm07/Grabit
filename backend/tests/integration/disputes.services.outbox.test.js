/**
 * Disputes, field-agent verification, service bookings, outbox push/SMS consumers.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { request } from '../helpers/supertest-lite.js';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
import { drainOnce } from '../../scripts/outbox-relay.js';

dotenv.config();

function token(user) {
	return jwt.sign(
		{ id: user.id, role: user.role, city_id: user.city_id, phone: user.phone },
		process.env.JWT_SECRET || 'test-secret',
		{ expiresIn: '1h' }
	);
}

describe('Disputes / verification / services / outbox consumers', () => {
	let app;
	let fx;
	let customer;
	let vendorUser;
	let admin;
	let fieldAgent;
	let ct;
	let vt;
	let at;
	let ft;
	let orderId;
	let listingId;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.PUSH_DRY_RUN = 'true';
		process.env.SMS_DRY_RUN = 'true';
		process.env.NODE_ENV = 'test';
		app = createApp();
		await resetDb();
		fx = await seedSplitFixture();

		customer = (await pool.query(`SELECT * FROM users WHERE phone = '9111111111'`)).rows[0];
		vendorUser = (await pool.query(`SELECT * FROM users WHERE phone = '9000000001'`)).rows[0];
		admin = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Admin', '9000000099', 'super_admin', TRUE, $1) RETURNING *`,
				[customer.city_id]
			)
		).rows[0];
		fieldAgent = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Agent', '9000000066', 'field_agent', TRUE, $1) RETURNING *`,
				[customer.city_id]
			)
		).rows[0];

		listingId = (
			await pool.query(`SELECT id FROM vendor_listings WHERE vendor_id = $1 LIMIT 1`, [
				fx.vendor1Id,
			])
		).rows[0].id;

		ct = token(customer);
		vt = token(vendorUser);
		at = token(admin);
		ft = token(fieldAgent);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `disp-order-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);
		orderId = placed.body.order.id;
	});

	after(async () => {});

	it('opens and resolves a dispute', async () => {
		const open = await request(app)
			.post('/api/disputes')
			.set('Authorization', `Bearer ${ct}`)
			.send({ order_id: orderId, reason: 'Missing item', details: 'Salt missing' });
		assert.equal(open.status, 201);
		assert.equal(open.body.dispute.status, 'open');

		const list = await request(app).get('/api/disputes').set('Authorization', `Bearer ${ct}`);
		assert.equal(list.status, 200);
		assert.ok(list.body.disputes.length >= 1);

		const resolve = await request(app)
			.post(`/api/disputes/${open.body.dispute.id}/resolve`)
			.set('Authorization', `Bearer ${at}`)
			.send({ status: 'resolved', resolution: 'Refund issued' });
		assert.equal(resolve.status, 200);
		assert.equal(resolve.body.dispute.status, 'resolved');
	});

	it('schedules and completes field-agent store verification', async () => {
		const schedule = await request(app)
			.post('/api/verification/schedule')
			.set('Authorization', `Bearer ${at}`)
			.send({
				vendor_id: fx.vendor1Id,
				field_agent_id: fieldAgent.id,
				notes: 'First visit',
			});
		assert.equal(schedule.status, 201);
		assert.equal(schedule.body.verification.status, 'scheduled');

		const mine = await request(app)
			.get('/api/verification')
			.set('Authorization', `Bearer ${ft}`);
		assert.equal(mine.status, 200);
		assert.ok(mine.body.verifications.some((v) => v.id === schedule.body.verification.id));

		const pass = await request(app)
			.patch(`/api/verification/${schedule.body.verification.id}`)
			.set('Authorization', `Bearer ${ft}`)
			.send({
				status: 'passed',
				checklist: { storefront: true, stock: true, hygiene: true, documents: true },
			});
		assert.equal(pass.status, 200);
		assert.equal(pass.body.verification.status, 'passed');

		const vendor = await pool.query(`SELECT verification_status FROM vendors WHERE id = $1`, [
			fx.vendor1Id,
		]);
		assert.equal(vendor.rows[0].verification_status, 'verified');
	});

	it('creates vendor service and books it end-to-end', async () => {
		const master = await request(app)
			.post('/api/services/master')
			.set('Authorization', `Bearer ${at}`)
			.send({ name: 'Plumbing visit', category: 'home', unit_label: 'visit' });
		assert.equal(master.status, 201);

		const upsert = await request(app)
			.post('/api/services/me')
			.set('Authorization', `Bearer ${vt}`)
			.send({
				master_service_id: master.body.service.id,
				title: 'Tap fix',
				price_paise: 29900,
				duration_minutes: 45,
			});
		assert.equal(upsert.status, 201);

		const publicList = await request(app).get(`/api/services/vendor/${fx.vendor1Id}`);
		assert.equal(publicList.status, 200);
		assert.ok(publicList.body.services.some((s) => s.title === 'Tap fix'));

		const start = new Date(Date.now() + 86_400_000).toISOString();
		const book = await request(app)
			.post('/api/services/bookings')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `book-${Date.now()}`)
			.send({
				vendor_service_id: upsert.body.service.id,
				scheduled_start: start,
				notes: 'Leaking kitchen tap',
			});
		assert.equal(book.status, 201);
		assert.equal(book.body.booking.status, 'requested');

		const accept = await request(app)
			.post(`/api/services/bookings/${book.body.booking.id}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'accepted' });
		assert.equal(accept.status, 200);
		assert.equal(accept.body.booking.status, 'accepted');

		const complete = await request(app)
			.post(`/api/services/bookings/${book.body.booking.id}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'in_progress' });
		assert.equal(complete.status, 200);

		const done = await request(app)
			.post(`/api/services/bookings/${book.body.booking.id}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'completed' });
		assert.equal(done.status, 200);
		assert.equal(done.body.booking.status, 'completed');
	});

	it('outbox consumer writes push/sms notification_log dry-runs', async () => {
		await pool.query(
			`INSERT INTO devices (user_id, expo_push_token, platform)
			 VALUES ($1, 'ExponentPushToken[test-customer]', 'ios')
			 ON CONFLICT DO NOTHING`,
			[customer.id]
		);

		const before = await pool.query(`SELECT COUNT(*)::int AS n FROM notification_log`);
		const result = await drainOnce(pool);
		assert.ok(result.scanned >= 1);
		assert.ok(result.published >= 1);

		const after = await pool.query(`SELECT COUNT(*)::int AS n FROM notification_log`);
		assert.ok(after.rows[0].n > before.rows[0].n);

		const sample = await pool.query(
			`SELECT channel, status FROM notification_log ORDER BY id DESC LIMIT 5`
		);
		assert.ok(sample.rows.every((r) => ['dry_run', 'skipped', 'sent'].includes(r.status)));

		const unpublished = await pool.query(
			`SELECT COUNT(*)::int AS n FROM outbox WHERE published_at IS NULL`
		);
		assert.equal(unpublished.rows[0].n, 0);
	});
});
