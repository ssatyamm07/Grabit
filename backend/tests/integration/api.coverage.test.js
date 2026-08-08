/**
 * Full API coverage — every public Grabit route is exercised before we call the suite green.
 * Run: npm run test:integration (includes this file)
 */
import { describe, it, before, after } from 'node:test';
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

describe('API coverage — all routes', () => {
	let app;
	let fx;
	let customer;
	let vendorUser;
	let admin;
	let delivery;
	let cityId;
	let listingId;
	let orderId;
	let listId;
	let addressId;
	let ct;
	let vt;
	let at;
	let dt;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.SHOW_OTP_IN_RESPONSE = 'true';
		process.env.PUSH_DRY_RUN = 'true';
		process.env.NODE_ENV = 'test';
		delete process.env.GOOGLE_MAPS_API_KEY;
		delete process.env.RAZORPAY_KEY_ID;
		delete process.env.RAZORPAY_KEY_SECRET;

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
			`INSERT INTO delivery_partners (user_id, city_id, is_active, location)
			 VALUES ($1, $2, TRUE, ST_SetSRID(ST_MakePoint(72.878, 19.077), 4326)::geography)`,
			[delivery.id, cityId]
		);

		listingId = (
			await pool.query(`SELECT id FROM vendor_listings WHERE vendor_id = $1 LIMIT 1`, [
				fx.vendor1Id,
			])
		).rows[0].id;

		ct = token(customer);
		vt = token(vendorUser);
		at = token(admin);
		dt = token(delivery);
	});

	after(async () => {});

	it('GET /api/health', async () => {
		const res = await request(app).get('/api/health');
		assert.equal(res.status, 200);
		assert.equal(res.body.status, 'OK');
	});

	it('Auth: send/verify/me/patch/refresh/logout', async () => {
		const send = await request(app)
			.post('/api/auth/send-otp')
			.send({ phone: '9444444444' });
		assert.equal(send.status, 200);
		assert.ok(send.body.dev_otp);

		const verify = await request(app)
			.post('/api/auth/verify-otp')
			.send({ phone: '9444444444', otp: send.body.dev_otp });
		assert.equal(verify.status, 200);
		assert.ok(verify.body.accessToken);
		assert.ok(verify.body.refreshToken);

		const me = await request(app)
			.get('/api/auth/me')
			.set('Authorization', `Bearer ${verify.body.accessToken}`);
		assert.equal(me.status, 200);

		const patch = await request(app)
			.patch('/api/auth/me')
			.set('Authorization', `Bearer ${verify.body.accessToken}`)
			.send({ name: 'Coverage User' });
		assert.equal(patch.status, 200);
		assert.equal(patch.body.user.name, 'Coverage User');

		const refresh = await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: verify.body.refreshToken });
		assert.equal(refresh.status, 200);
		assert.ok(refresh.body.accessToken);

		const logout = await request(app)
			.post('/api/auth/logout')
			.send({ refreshToken: refresh.body.refreshToken });
		assert.equal(logout.status, 200);
	});

	it('Catalog: search, categories, brands, get by id', async () => {
		const cats = await request(app).get('/api/catalog/master/categories');
		assert.equal(cats.status, 200);
		assert.ok(Array.isArray(cats.body.categories));

		const brands = await request(app).get('/api/catalog/master/brands');
		assert.equal(brands.status, 200);

		const search = await request(app).get('/api/catalog/master/search?q=Amul');
		assert.equal(search.status, 200);
		assert.ok(search.body.products.length >= 1);

		const one = await request(app).get(`/api/catalog/master/${fx.milkId}`);
		assert.equal(one.status, 200);
		assert.equal(one.body.product.id, fx.milkId);
	});

	it('Geo serviceable + vendors list/storefront', async () => {
		const geo = await request(app).get(
			`/api/geo/serviceable?lat=${fx.lat}&lng=${fx.lng}`
		);
		assert.equal(geo.status, 200);
		assert.ok(geo.body.vendors.length >= 1);

		const vendors = await request(app).get(
			`/api/vendors?lat=${fx.lat}&lng=${fx.lng}`
		);
		assert.equal(vendors.status, 200);

		const store = await request(app).get(`/api/vendors/${fx.vendor1Id}/storefront`);
		assert.equal(store.status, 200);
		assert.ok(store.body.items.length >= 1);
	});

	it('Addresses CRUD + geocode + places autocomplete', async () => {
		const created = await request(app)
			.post('/api/addresses')
			.set('Authorization', `Bearer ${ct}`)
			.send({
				label: 'Office',
				lat: 19.07,
				lng: 72.87,
				pincode: '400001',
				is_default: false,
			});
		assert.equal(created.status, 201);
		addressId = created.body.address.id;

		const list = await request(app).get('/api/addresses').set('Authorization', `Bearer ${ct}`);
		assert.equal(list.status, 200);

		const get = await request(app)
			.get(`/api/addresses/${addressId}`)
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(get.status, 200);

		const def = await request(app)
			.put(`/api/addresses/${addressId}/default`)
			.set('Authorization', `Bearer ${ct}`)
			.send({});
		assert.equal(def.status, 200);
		assert.equal(def.body.address.is_default, true);

		const search = await request(app)
			.get('/api/addresses/geocode/search?q=Andheri%20Mumbai')
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(search.status, 200);
		assert.ok(Array.isArray(search.body.results));

		const reverse = await request(app)
			.get('/api/addresses/geocode/reverse?lat=19.076&lon=72.8777')
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(reverse.status, 200);
		assert.ok(reverse.body.display_name || reverse.body.line1);

		const places = await request(app)
			.get('/api/addresses/places/autocomplete?q=Bandra')
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(places.status, 200);
		assert.ok(Array.isArray(places.body.results));

		const patch = await request(app)
			.patch(`/api/addresses/${addressId}`)
			.set('Authorization', `Bearer ${ct}`)
			.send({ label: 'Office 2', lat: 19.071, lng: 72.871 });
		assert.equal(patch.status, 200);
	});

	it('Settings + info pages', async () => {
		await pool.query(
			`INSERT INTO app_settings (key, value) VALUES ('brand', '{"name":"Grabit"}'::jsonb)
			 ON CONFLICT (key) DO NOTHING`
		);
		const settings = await request(app).get('/api/app-settings');
		assert.equal(settings.status, 200);

		const pages = await request(app).get('/api/info-pages');
		assert.equal(pages.status, 200);
		assert.ok(pages.body.pages.length >= 1);

		const page = await request(app).get('/api/info-pages/privacy');
		assert.equal(page.status, 200);
	});

	it('Devices register / push / unregister', async () => {
		const reg = await request(app)
			.post('/api/devices/register')
			.set('Authorization', `Bearer ${ct}`)
			.send({ expo_push_token: 'ExponentPushToken[test]', platform: 'ios' });
		assert.equal(reg.status, 201);

		const push = await request(app)
			.post('/api/devices/push')
			.set('Authorization', `Bearer ${ct}`)
			.send({ title: 'Hi', body: 'Test push' });
		assert.equal(push.status, 200);
		assert.equal(push.body.dry_run, true);

		const unreg = await request(app)
			.delete('/api/devices/register')
			.set('Authorization', `Bearer ${ct}`)
			.send({ expo_push_token: 'ExponentPushToken[test]' });
		assert.equal(unreg.status, 200);
	});

	it('Lists CRUD + checkout preview/confirm', async () => {
		const create = await request(app)
			.post('/api/lists')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `list-${Date.now()}`)
			.send({ name: 'Coverage list', list_type: 'grocery' });
		assert.equal(create.status, 201);
		listId = create.body.list.id;

		const add = await request(app)
			.post(`/api/lists/${listId}/items`)
			.set('Authorization', `Bearer ${ct}`)
			.send({ master_product_id: fx.saltId, qty: 1 });
		assert.equal(add.status, 201);

		const preview = await request(app)
			.post(`/api/lists/${listId}/checkout/preview`)
			.set('Authorization', `Bearer ${ct}`)
			.send({ lat: fx.lat, lng: fx.lng });
		assert.equal(preview.status, 200);
		assert.ok(preview.body.preview_token);

		if (preview.body.can_confirm) {
			const confirm = await request(app)
				.post(`/api/lists/${listId}/checkout`)
				.set('Authorization', `Bearer ${ct}`)
				.set('Idempotency-Key', `chk-${Date.now()}`)
				.send({ preview_token: preview.body.preview_token, fulfillment_mode: 'self' });
			assert.equal(confirm.status, 201);
		}
	});

	it('Orders: place, quote, accept alias, events, tracking, payment COD, settle, refund', async () => {
		const quote = await request(app)
			.get(
				`/api/orders/delivery-quote?vendor_id=${fx.vendor1Id}&lat=${fx.lat}&lng=${fx.lng}`
			)
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(quote.status, 200);
		assert.equal(quote.body.serviceable, true);
		assert.ok(quote.body.delivery_fee_paise > 0);

		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `ord-cov-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
				delivery_address: { lat: fx.lat, lng: fx.lng },
			});
		assert.equal(placed.status, 201, JSON.stringify(placed.body));
		orderId = placed.body.order.id;

		const pay = await request(app)
			.post('/api/payment/create')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `pay-${Date.now()}`)
			.send({ order_id: orderId, provider: 'cod' });
		assert.equal(pay.status, 201);
		assert.equal(pay.body.payment.provider, 'cod');

		const razorMissing = await request(app)
			.post('/api/payment/create')
			.set('Authorization', `Bearer ${ct}`)
			.send({ order_id: orderId, provider: 'razorpay' });
		// may 409 if unique or 503 not configured — either acceptable for coverage
		assert.ok([409, 503].includes(razorMissing.status));

		const accept = await request(app)
			.post(`/api/orders/${orderId}/accept`)
			.set('Authorization', `Bearer ${vt}`)
			.send({});
		assert.equal(accept.status, 200);

		for (const to of ['preparing', 'ready', 'picked']) {
			const r = await request(app)
				.post(`/api/orders/${orderId}/status`)
				.set('Authorization', `Bearer ${vt}`)
				.send({
					to_status: to,
					...(to === 'delivered' ? {} : {}),
				});
			assert.equal(r.status, 200, JSON.stringify(r.body));
		}

		const readyOtp = (
			await pool.query(`SELECT delivery_otp_hash FROM orders WHERE id = $1`, [orderId])
		).rows[0];
		assert.ok(readyOtp.delivery_otp_hash);

		// Get OTP from last ready transition — re-fetch by marking isn't possible; use known path:
		// Order is picked; need delivered with OTP. Generate known OTP in DB for test.
		const crypto = await import('crypto');
		const plain = '654321';
		const hash = crypto.createHash('sha256').update(plain).digest('hex');
		await pool.query(
			`UPDATE orders SET delivery_otp_hash = $1, delivery_otp_expires_at = NOW() + interval '1 day'
			 WHERE id = $2`,
			[hash, orderId]
		);

		const delivered = await request(app)
			.post(`/api/orders/${orderId}/transition`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ to_status: 'delivered', delivery_otp: plain });
		assert.equal(delivered.status, 200);

		const events = await request(app)
			.get(`/api/orders/${orderId}/events`)
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(events.status, 200);
		assert.ok(events.body.events.length >= 2);

		const track = await request(app)
			.get(`/api/orders/${orderId}/tracking`)
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(track.status, 200);
		assert.equal(track.body.order_id, orderId);
		assert.ok(track.body.eta || track.body.vendor);

		const settle = await request(app)
			.post('/api/payment/settle-commission')
			.set('Authorization', `Bearer ${at}`)
			.send({ order_id: orderId });
		assert.equal(settle.status, 201);
		assert.ok(settle.body.settlement.commission_paise >= 0);

		const refund = await request(app)
			.post('/api/payment/refund')
			.set('Authorization', `Bearer ${at}`)
			.send({ order_id: orderId, reason: 'coverage test' });
		assert.equal(refund.status, 201);

		const mine = await request(app).get('/api/orders/me').set('Authorization', `Bearer ${ct}`);
		assert.equal(mine.status, 200);

		const vendorOrders = await request(app)
			.get('/api/orders/vendor')
			.set('Authorization', `Bearer ${vt}`);
		assert.equal(vendorOrders.status, 200);

		const ledger = await request(app).get('/api/ledger/me').set('Authorization', `Bearer ${ct}`);
		assert.equal(ledger.status, 200);
	});

	it('Partner fulfillment + delivery jobs + webhook stub', async () => {
		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `ord-partner-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'partner',
				items: [{ listing_id: listingId, qty: 1 }],
				delivery_address: { lat: fx.lat, lng: fx.lng },
			});
		assert.equal(placed.status, 201);
		const oid = placed.body.order.id;

		let otp;
		for (const to of ['accepted', 'preparing', 'ready']) {
			const r = await request(app)
				.post(`/api/orders/${oid}/transition`)
				.set('Authorization', `Bearer ${vt}`)
				.send({ to_status: to });
			assert.equal(r.status, 200, JSON.stringify(r.body));
			if (to === 'ready') otp = r.body.delivery_otp;
		}
		assert.ok(otp);

		const me = await request(app).get('/api/delivery/me').set('Authorization', `Bearer ${dt}`);
		assert.equal(me.status, 200);

		const loc = await request(app)
			.patch('/api/delivery/me/location')
			.set('Authorization', `Bearer ${dt}`)
			.send({ lat: 19.077, lng: 72.878 });
		assert.equal(loc.status, 200);

		const jobs = await request(app).get('/api/delivery/jobs').set('Authorization', `Bearer ${dt}`);
		assert.equal(jobs.status, 200);
		const job = jobs.body.jobs.find((j) => j.order_id === oid);
		assert.ok(job);

		assert.equal(
			(
				await request(app)
					.post(`/api/delivery/jobs/${job.id}/accept`)
					.set('Authorization', `Bearer ${dt}`)
					.send({})
			).status,
			200
		);
		assert.equal(
			(
				await request(app)
					.post(`/api/delivery/jobs/${job.id}/pickup`)
					.set('Authorization', `Bearer ${dt}`)
					.send({})
			).status,
			200
		);
		const done = await request(app)
			.post(`/api/delivery/jobs/${job.id}/complete`)
			.set('Authorization', `Bearer ${dt}`)
			.send({ delivery_otp: otp });
		assert.equal(done.status, 200);

		const track = await request(app)
			.get(`/api/orders/${oid}/tracking`)
			.set('Authorization', `Bearer ${ct}`);
		assert.equal(track.status, 200);

		const wh = await request(app).post('/api/payment/webhook').send({ event: 'ping' });
		assert.ok([200, 503].includes(wh.status));
	});

	it('Vendor apply/profile/proposals + admin catalog browse + approve', async () => {
		const applicant = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('AppV', '9555555555', 'customer', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];
		const apt = token(applicant);

		const apply = await request(app)
			.post('/api/vendors/me/apply')
			.set('Authorization', `Bearer ${apt}`)
			.send({
				business_name: 'Coverage Kirana',
				lat: fx.lat,
				lng: fx.lng,
				city_id: cityId,
			});
		assert.equal(apply.status, 201);

		const vendorTok = token({ ...applicant, role: 'vendor' });
		const profile = await request(app)
			.get('/api/vendors/me')
			.set('Authorization', `Bearer ${vendorTok}`);
		assert.equal(profile.status, 200);

		const patch = await request(app)
			.patch('/api/vendors/me')
			.set('Authorization', `Bearer ${vendorTok}`)
			.send({ is_open: true, fulfillment_mode_default: 'either' });
		assert.equal(patch.status, 200);

		const proposal = await request(app)
			.post('/api/vendors/me/proposals')
			.set('Authorization', `Bearer ${vendorTok}`)
			.send({ name: 'New Snack', brand: 'Local', category: 'Snacks' });
		assert.equal(proposal.status, 201);

		const props = await request(app)
			.get('/api/vendors/me/proposals')
			.set('Authorization', `Bearer ${vendorTok}`);
		assert.equal(props.status, 200);

		assert.equal(
			(await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(await request(app).get('/api/admin/vendors?approved=false').set('Authorization', `Bearer ${at}`))
				.status,
			200
		);
		assert.equal(
			(
				await request(app)
					.post(`/api/admin/vendors/${apply.body.vendor.id}/approve`)
					.set('Authorization', `Bearer ${at}`)
					.send({})
			).status,
			200
		);

		assert.equal(
			(await request(app).get('/api/admin/catalog/categories').set('Authorization', `Bearer ${at}`))
				.status,
			200
		);
		assert.equal(
			(await request(app).get('/api/admin/catalog/brands').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(await request(app).get('/api/admin/catalog/master?q=Amul').set('Authorization', `Bearer ${at}`))
				.status,
			200
		);

		const createMp = await request(app)
			.post('/api/admin/catalog/master')
			.set('Authorization', `Bearer ${at}`)
			.send({ name: 'Coverage SKU', brand: 'Test', category: 'Grocery', barcode: '9990001112223' });
		assert.equal(createMp.status, 201);

		assert.equal(
			(
				await request(app)
					.patch(`/api/admin/catalog/master/${createMp.body.product.id}`)
					.set('Authorization', `Bearer ${at}`)
					.send({ unit_label: '1 pc' })
			).status,
			200
		);

		assert.equal(
			(await request(app).get('/api/admin/proposals').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(
				await request(app)
					.post(`/api/admin/proposals/${proposal.body.proposal.id}/approve`)
					.set('Authorization', `Bearer ${at}`)
					.send({})
			).status,
			200
		);

		assert.equal(
			(await request(app).get('/api/admin/users?q=911').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${at}`)).status,
			200
		);
		assert.equal(
			(
				await request(app)
					.put('/api/admin/settings/delivery')
					.set('Authorization', `Bearer ${at}`)
					.send({ value: { min_fee_paise: 2000 } })
			).status,
			200
		);
		assert.equal(
			(
				await request(app)
					.put('/api/admin/info-pages/coverage')
					.set('Authorization', `Bearer ${at}`)
					.send({ title: 'Coverage', body: 'ok' })
			).status,
			200
		);

		const listing = await request(app)
			.post('/api/vendors/me/listings')
			.set('Authorization', `Bearer ${vendorTok}`)
			.send({ master_product_id: createMp.body.product.id, price_paise: 1000, qty: 10 });
		assert.equal(listing.status, 201);

		assert.equal(
			(
				await request(app)
					.patch(`/api/vendors/me/listings/${listing.body.listing.id}`)
					.set('Authorization', `Bearer ${vendorTok}`)
					.send({ price_paise: 1100 })
			).status,
			200
		);
		assert.equal(
			(
				await request(app)
					.patch(`/api/vendors/me/inventory/${listing.body.listing.id}`)
					.set('Authorization', `Bearer ${vendorTok}`)
					.send({ qty: 20 })
			).status,
			200
		);
		assert.equal(
			(await request(app).get('/api/vendors/me/listings').set('Authorization', `Bearer ${vendorTok}`))
				.status,
			200
		);
	});

	it('Reject alias works on a fresh placed order', async () => {
		const placed = await request(app)
			.post('/api/orders')
			.set('Authorization', `Bearer ${ct}`)
			.set('Idempotency-Key', `ord-rej-${Date.now()}`)
			.send({
				vendor_id: fx.vendor1Id,
				fulfillment_mode: 'self',
				items: [{ listing_id: listingId, qty: 1 }],
			});
		assert.equal(placed.status, 201);
		const rej = await request(app)
			.post(`/api/orders/${placed.body.order.id}/reject`)
			.set('Authorization', `Bearer ${vt}`)
			.send({ reason: 'out of stock' });
		assert.equal(rej.status, 200);
		assert.equal(rej.body.order.status, 'rejected');
	});
});
