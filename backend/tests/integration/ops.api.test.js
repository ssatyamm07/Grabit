import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
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

describe('ops integration: addresses, vendor apply, fulfillment, delivery, admin', () => {
	let app;
	let fx;
	let customer;
	let vendorUser;
	let admin;
	let delivery;
	let regional;
	let listingId;
	let cityId;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.SHOW_OTP_IN_RESPONSE = 'true';
		app = createApp();
		await resetDb();
		fx = await seedSplitFixture();

		customer = (await pool.query(`SELECT * FROM users WHERE phone = '9111111111'`)).rows[0];
		vendorUser = (await pool.query(`SELECT * FROM users WHERE phone = '9000000001'`)).rows[0];
		cityId = customer.city_id;

		admin = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Admin', '9000000099', 'super_admin', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];

		delivery = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Rider', '9000000088', 'delivery', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];
		await pool.query(
			`INSERT INTO delivery_partners (user_id, city_id, is_active) VALUES ($1, $2, TRUE)`,
			[delivery.id, cityId]
		);

		regional = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Reg', '9000000077', 'regional_admin', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];

		const otherCity = await pool.query(
			`INSERT INTO cities (name, state, region) VALUES ('Other City', 'KA', 'South') RETURNING id`
		);
		const otherVendorUser = await pool.query(
			`INSERT INTO users (name, phone, role, phone_verified, city_id)
			 VALUES ('OtherV', '9000000066', 'vendor', TRUE, $1) RETURNING id`,
			[otherCity.rows[0].id]
		);
		await pool.query(
			`INSERT INTO vendors (user_id, business_name, city_id, is_approved, is_open, location, coverage_radius_m)
			 VALUES ($1, 'Far Shop', $2, FALSE, TRUE,
			   ST_SetSRID(ST_MakePoint(77.59, 12.97), 4326)::geography, 3000)`,
			[otherVendorUser.rows[0].id, otherCity.rows[0].id]
		);

		listingId = (
			await pool.query(`SELECT id FROM vendor_listings WHERE vendor_id = $1 LIMIT 1`, [
				fx.vendor1Id,
			])
		).rows[0].id;
	});

	after(async () => {});

	it('address CRUD', async () => {
		const t = token(customer);
		const created = await request(app)
			.post('/api/addresses')
			.set('Authorization', `Bearer ${t}`)
			.send({
				label: 'Work',
				area: 'Bandra',
				pincode: '400050',
				lat: 19.06,
				lng: 72.83,
				is_default: false,
			});
		assert.equal(created.status, 201);
		const id = created.body.address.id;

		const listed = await request(app).get('/api/addresses').set('Authorization', `Bearer ${t}`);
		assert.ok(listed.body.addresses.length >= 2);

		const del = await request(app)
			.delete(`/api/addresses/${id}`)
			.set('Authorization', `Bearer ${t}`)
			.send();
		assert.equal(del.status, 200);
	});

	it('vendor apply → admin approve → listing allowed', async () => {
		const applicant = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('NewV', '9333333333', 'customer', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];
		const t = token(applicant);
		const apply = await request(app)
			.post('/api/vendors/me/apply')
			.set('Authorization', `Bearer ${t}`)
			.send({
				business_name: 'New Kirana',
				lat: 19.076,
				lng: 72.8777,
				city_id: cityId,
			});
		assert.equal(apply.status, 201);
		assert.equal(apply.body.vendor.is_approved, false);

		const vendorTok = token({ ...applicant, role: 'vendor' });
		const blocked = await request(app)
			.post('/api/vendors/me/listings')
			.set('Authorization', `Bearer ${vendorTok}`)
			.send({ master_product_id: fx.milkId, price_paise: 1000, qty: 5 });
		assert.equal(blocked.status, 403);

		const approve = await request(app)
			.post(`/api/admin/vendors/${apply.body.vendor.id}/approve`)
			.set('Authorization', `Bearer ${token(admin)}`)
			.send({});
		assert.equal(approve.status, 200);
		assert.equal(approve.body.vendor.is_approved, true);

		const listing = await request(app)
			.post('/api/vendors/me/listings')
			.set('Authorization', `Bearer ${vendorTok}`)
			.send({ master_product_id: fx.milkId, price_paise: 1000, qty: 5 });
		assert.equal(listing.status, 201);
	});

	it('self-delivery path with OTP', async () => {
		const ct = token(customer);
		const vt = token(vendorUser);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `self-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
				delivery_address: { lat: 19.076, lng: 72.8777 },
			});
		assert.equal(placed.status, 201, JSON.stringify(placed.body));
		assert.equal(placed.body.order.fulfillment_mode, 'self');
		const orderId = placed.body.order.id;

		for (const to of ['accepted', 'preparing']) {
			const r = await request(app)
				.post(`/api/orders/${orderId}/transition`)
				.set('Authorization', `Bearer ${vt}`)
				.send({ to_status: to });
			assert.equal(r.status, 200, r.body.error);
		}

		const ready = await request(app)
			.post(`/api/orders/${orderId}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'ready' });
		assert.equal(ready.status, 200);
		assert.ok(ready.body.delivery_otp);

		const picked = await request(app)
			.post(`/api/orders/${orderId}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'picked' });
		assert.equal(picked.status, 200);

		const delivered = await request(app)
			.post(`/api/orders/${orderId}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'delivered', delivery_otp: ready.body.delivery_otp });
		assert.equal(delivered.status, 200);
		assert.equal(delivered.body.order.status, 'delivered');
	});

	it('partner delivery job complete with OTP', async () => {
		const ct = token(customer);
		const vt = token(vendorUser);
		const dt = token(delivery);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `partner-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'partner',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201, JSON.stringify(placed.body));
		const orderId = placed.body.order.id;

		let otp = null;
		for (const to of ['accepted', 'preparing', 'ready']) {
			const r = await request(app)
				.post(`/api/orders/${orderId}/transition`)
				.set('Authorization', `Bearer ${vt}`)
				.send({ to_status: to });
			assert.equal(r.status, 200, JSON.stringify(r.body));
			if (to === 'ready') otp = r.body.delivery_otp;
		}
		assert.ok(otp);

		const jobs = await request(app).get('/api/delivery/jobs').set('Authorization', `Bearer ${dt}`);
		assert.equal(jobs.status, 200);
		const job = jobs.body.jobs.find((j) => j.order_id === orderId);
		assert.ok(job, 'job should exist');

		const accept = await request(app)
			.post(`/api/delivery/jobs/${job.id}/accept`)
			.set('Authorization', `Bearer ${dt}`)
			.send({});
		assert.equal(accept.status, 200);

		const pickup = await request(app)
			.post(`/api/delivery/jobs/${job.id}/pickup`)
			.set('Authorization', `Bearer ${dt}`)
			.send({});
		assert.equal(pickup.status, 200);
		assert.equal(pickup.body.order.status, 'picked');

		const complete = await request(app)
			.post(`/api/delivery/jobs/${job.id}/complete`)
			.set('Authorization', `Bearer ${dt}`)
			.send({ delivery_otp: otp });
		assert.equal(complete.status, 200, JSON.stringify(complete.body));
		assert.equal(complete.body.order.status, 'delivered');
	});

	it('regional admin blocked outside city; customer cannot hit admin', async () => {
		const far = (await pool.query(`SELECT id FROM vendors WHERE business_name = 'Far Shop'`))
			.rows[0];
		const denied = await request(app)
			.post(`/api/admin/vendors/${far.id}/approve`)
			.set('Authorization', `Bearer ${token(regional)}`)
			.send({});
		assert.equal(denied.status, 404);

		const forbidden = await request(app)
			.get('/api/admin/stats')
			.set('Authorization', `Bearer ${token(customer)}`);
		assert.equal(forbidden.status, 403);
	});
});
