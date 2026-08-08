/**
 * P1: dispute→refund, booking slot conflict + COD payment, support PII mask
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { request } from '../helpers/supertest-lite.js';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import { createApp } from '../../src/app.js';

dotenv.config();

function token(user) {
	return jwt.sign(
		{ id: user.id, role: user.role, city_id: user.city_id, phone: user.phone },
		process.env.JWT_SECRET || 'test-secret',
		{ expiresIn: '1h' }
	);
}

describe('P1 closed loops', () => {
	let app;
	let fx;
	let customer;
	let vendorUser;
	let admin;
	let support;
	let ct;
	let vt;
	let at;
	let st;
	let listingId;
	let orderId;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
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
		support = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Support', '9000000055', 'support', TRUE, $1) RETURNING *`,
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
		st = token(support);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `p1-order-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);
		orderId = placed.body.order.id;

		const pay = await request(app)
			.post('/api/payment/create')
			.set('Authorization', `Bearer ${ct}`)
			.send({ order_id: orderId, provider: 'cod' });
		assert.equal(pay.status, 201);
	});

	it('resolve dispute with issue_refund closes the loop', async () => {
		const open = await request(app)
			.post('/api/disputes')
			.set('Authorization', `Bearer ${ct}`)
			.send({ order_id: orderId, reason: 'Damaged goods' });
		assert.equal(open.status, 201);

		const resolve = await request(app)
			.post(`/api/disputes/${open.body.dispute.id}/resolve`)
			.set('Authorization', `Bearer ${st}`)
			.send({
				status: 'resolved',
				resolution: 'Full refund',
				issue_refund: true,
			});
		assert.equal(resolve.status, 200);
		assert.ok(resolve.body.refund);
		assert.equal(resolve.body.refund.dispute_id, open.body.dispute.id);

		const payment = await pool.query(`SELECT status FROM payments WHERE order_id = $1`, [
			orderId,
		]);
		assert.equal(payment.rows[0].status, 'refunded');

		const audits = await pool.query(
			`SELECT action FROM audit_logs WHERE entity_type = 'dispute' AND entity_id = $1`,
			[String(open.body.dispute.id)]
		);
		assert.ok(audits.rowCount >= 1);
	});

	it('service booking rejects overlapping slots and accepts COD payment', async () => {
		const svc = await request(app)
			.post('/api/services/me')
			.set('Authorization', `Bearer ${vt}`)
			.send({ title: 'Fan install', price_paise: 49900, duration_minutes: 60 });
		assert.equal(svc.status, 201);

		const start = new Date(Date.now() + 2 * 86_400_000);
		start.setHours(10, 0, 0, 0);
		const book = await request(app)
			.post('/api/services/bookings')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `p1-book-${Date.now()}`)
			.send({
				vendor_service_id: svc.body.service.id,
				scheduled_start: start.toISOString(),
			});
		assert.equal(book.status, 201);

		const clash = await request(app)
			.post('/api/services/bookings')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `p1-book-clash-${Date.now()}`)
			.send({
				vendor_service_id: svc.body.service.id,
				scheduled_start: new Date(start.getTime() + 15 * 60_000).toISOString(),
			});
		assert.equal(clash.status, 409);
		assert.equal(clash.body.code, 'SLOT_CONFLICT');

		const pay = await request(app)
			.post('/api/payment/create')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `p1-book-pay-${Date.now()}`)
			.send({ booking_id: book.body.booking.id, provider: 'cod' });
		assert.equal(pay.status, 201);
		assert.equal(pay.body.payment.booking_id, book.body.booking.id);

		const booking = await pool.query(
			`SELECT payment_status FROM service_bookings WHERE id = $1`,
			[book.body.booking.id]
		);
		assert.equal(booking.rows[0].payment_status, 'cod_pending');
	});

	it('support list users masks phone', async () => {
		const res = await request(app)
			.get('/api/admin/users?q=911')
			.set('Authorization', `Bearer ${st}`);
		assert.equal(res.status, 200);
		assert.equal(res.body.pii_masked, true);
		const hit = res.body.users.find((u) => String(u.phone).endsWith('1111'));
		assert.ok(hit);
		assert.match(hit.phone, /^\*+1111$/);

		const adminRes = await request(app)
			.get('/api/admin/users?q=911')
			.set('Authorization', `Bearer ${at}`);
		assert.equal(adminRes.body.pii_masked, false);
		const full = adminRes.body.users.find((u) => u.phone === '9111111111');
		assert.ok(full);
	});
});
