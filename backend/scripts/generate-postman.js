#!/usr/bin/env node
/**
 * Generates docs/postman/Grabit.postman_collection.json + environment.
 * Run: node backend/scripts/generate-postman.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'docs/postman');

function uid() {
	return Math.random().toString(16).slice(2) + Date.now().toString(16).slice(-6);
}

function hdr(extra = []) {
	return [
		{ key: 'Accept', value: 'application/json' },
		{ key: 'Content-Type', value: 'application/json' },
		...extra,
	];
}

function authBearer(tokenVar) {
	return {
		type: 'bearer',
		bearer: [{ key: 'token', value: `{{${tokenVar}}}`, type: 'string' }],
	};
}

function url(pathStr, query = []) {
	const raw = `{{baseUrl}}${pathStr.startsWith('/') ? pathStr : `/${pathStr}`}`;
	const pathParts = pathStr.replace(/^\//, '').split('/').filter(Boolean);
	return {
		raw: query.length
			? `${raw}?${query.map((q) => `${q.key}=${q.value}`).join('&')}`
			: raw,
		host: ['{{baseUrl}}'],
		path: pathParts,
		query: query.map((q) => ({ key: q.key, value: q.value, disabled: q.disabled || false })),
	};
}

function req({
	name,
	method,
	path: p,
	auth,
	body,
	query,
	headers,
	description,
	tests,
	prerequest,
	idempotency,
}) {
	const h = hdr(headers || []);
	if (idempotency) {
		h.push({ key: 'Idempotency-Key', value: idempotency === true ? '{{idempotencyKey}}' : idempotency });
	}
	const item = {
		name,
		request: {
			method,
			header: h,
			url: url(p, query),
			description: description || '',
		},
		response: [],
	};
	if (auth === false) {
		item.request.auth = { type: 'noauth' };
	} else if (typeof auth === 'string') {
		item.request.auth = authBearer(auth);
	}
	if (body !== undefined) {
		item.request.body = {
			mode: 'raw',
			raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
		};
	}
	const events = [];
	if (prerequest) {
		events.push({
			listen: 'prerequest',
			script: { type: 'text/javascript', exec: prerequest.split('\n') },
		});
	}
	if (tests) {
		events.push({
			listen: 'test',
			script: { type: 'text/javascript', exec: tests.split('\n') },
		});
	}
	if (events.length) item.event = events;
	return item;
}

function folder(name, items, description = '') {
	return { name, description, item: items };
}

const saveToken = (phoneVar, tokenVar, refreshVar = 'refreshToken') => `
pm.test('status 200', () => pm.response.to.have.status(200));
const j = pm.response.json();
if (j.accessToken) {
  pm.environment.set('${tokenVar}', j.accessToken);
  if (j.refreshToken) pm.environment.set('${refreshVar}', j.refreshToken);
  if (j.user && j.user.id) pm.environment.set('${tokenVar.replace('Token', 'UserId')}', String(j.user.id));
}
`;

const expectStatus = (code, note = '') => `
pm.test('expected ${code}${note ? ' — ' + note : ''}', () => pm.response.to.have.status(${code}));
`;

const expectStatusOneOf = (codes, note = '') => `
pm.test('expected one of [${codes.join(',')}]${note ? ' — ' + note : ''}', () => {
  pm.expect([${codes.join(',')}]).to.include(pm.response.code);
});
`;

// ─── Route catalog (happy-path examples) ───────────────────────────────────

const authHealth = [
	req({
		name: 'GET Health',
		method: 'GET',
		path: '/health',
		auth: false,
		description: 'No auth. 200 OK or 503 DEGRADED.',
		tests: expectStatusOneOf([200, 503]),
	}),
	req({
		name: 'POST Auth send-otp (customer)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{customerPhone}}' },
		description: 'With SHOW_OTP_IN_RESPONSE=true, response includes dev_otp.',
		tests: `
pm.test('otp accepted', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('customerOtp', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (customer)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{customerPhone}}', otp: '{{customerOtp}}' },
		description: 'Sets customerToken. Copy OTP from send-otp if not auto-set.',
		tests: saveToken('customerPhone', 'customerToken'),
	}),
	req({
		name: 'POST Auth send-otp (vendor)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{vendorPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('vendorOtp', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (vendor)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{vendorPhone}}', otp: '{{vendorOtp}}' },
		tests: saveToken('vendorPhone', 'vendorToken'),
	}),
	req({
		name: 'POST Auth send-otp (delivery)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{deliveryPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('deliveryOtpLogin', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (delivery)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{deliveryPhone}}', otp: '{{deliveryOtpLogin}}' },
		tests: saveToken('deliveryPhone', 'deliveryToken'),
	}),
	req({
		name: 'POST Auth send-otp (admin)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{adminPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('adminOtp', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (admin)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{adminPhone}}', otp: '{{adminOtp}}' },
		tests: saveToken('adminPhone', 'adminToken'),
	}),
	req({
		name: 'POST Auth send-otp (regional)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{regionalPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('regionalOtp', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (regional)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{regionalPhone}}', otp: '{{regionalOtp}}' },
		tests: saveToken('regionalPhone', 'regionalToken'),
	}),
	req({
		name: 'POST Auth send-otp (field agent)',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{fieldPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('fieldOtp', j.dev_otp);
`,
	}),
	req({
		name: 'POST Auth verify-otp (field agent)',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{fieldPhone}}', otp: '{{fieldOtp}}' },
		tests: saveToken('fieldPhone', 'fieldToken'),
	}),
	req({
		name: 'POST Auth refresh',
		method: 'POST',
		path: '/auth/refresh',
		auth: false,
		body: { refreshToken: '{{refreshToken}}' },
		tests: `
pm.test('refresh ok', () => pm.response.to.have.status(200));
const j = pm.response.json();
if (j.accessToken) pm.environment.set('customerToken', j.accessToken);
if (j.refreshToken) pm.environment.set('refreshToken', j.refreshToken);
`,
	}),
	req({
		name: 'POST Auth logout',
		method: 'POST',
		path: '/auth/logout',
		auth: false,
		body: { refreshToken: '{{refreshToken}}' },
		description: 'Revokes refresh token. Re-verify OTP after this.',
	}),
	req({
		name: 'GET Auth me',
		method: 'GET',
		path: '/auth/me',
		auth: 'customerToken',
		tests: expectStatus(200),
	}),
	req({
		name: 'PATCH Auth me',
		method: 'PATCH',
		path: '/auth/me',
		auth: 'customerToken',
		body: { name: 'Grabit Tester' },
		tests: expectStatus(200),
	}),
];

const publicCatalog = [
	req({
		name: 'GET Catalog master search',
		method: 'GET',
		path: '/catalog/master/search',
		auth: false,
		query: [{ key: 'q', value: 'Amul' }],
		tests: expectStatus(200),
	}),
	req({
		name: 'GET Catalog categories',
		method: 'GET',
		path: '/catalog/master/categories',
		auth: false,
	}),
	req({
		name: 'GET Catalog brands',
		method: 'GET',
		path: '/catalog/master/brands',
		auth: false,
	}),
	req({
		name: 'GET Catalog master by id',
		method: 'GET',
		path: '/catalog/master/{{masterProductId}}',
		auth: false,
		description: 'Set masterProductId from search results.',
	}),
	req({
		name: 'GET Geo serviceable',
		method: 'GET',
		path: '/geo/serviceable',
		auth: false,
		query: [
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
	}),
	req({
		name: 'GET Search unified',
		method: 'GET',
		path: '/search',
		auth: false,
		query: [
			{ key: 'q', value: 'milk' },
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
			{ key: 'limit', value: '20' },
		],
		tests: `
pm.test('200', () => pm.response.to.have.status(200));
const j = pm.response.json();
pm.expect(j).to.have.property('products');
`,
	}),
	req({
		name: 'GET Search synonym doodh',
		method: 'GET',
		path: '/search',
		auth: false,
		query: [{ key: 'q', value: 'doodh' }],
		description: 'Synonym expansion should include milk in terms[].',
	}),
	req({
		name: 'GET Reviews by vendor',
		method: 'GET',
		path: '/reviews/vendor/{{vendorId}}',
		auth: false,
	}),
	req({
		name: 'GET Services master',
		method: 'GET',
		path: '/services/master',
		auth: false,
	}),
	req({
		name: 'GET Services by vendor',
		method: 'GET',
		path: '/services/vendor/{{vendorId}}',
		auth: false,
	}),
	req({
		name: 'GET App settings',
		method: 'GET',
		path: '/app-settings',
		auth: false,
	}),
	req({
		name: 'GET Info pages',
		method: 'GET',
		path: '/info-pages',
		auth: false,
	}),
	req({
		name: 'GET Info page by slug',
		method: 'GET',
		path: '/info-pages/about',
		auth: false,
	}),
	req({
		name: 'GET Vendors open (geo)',
		method: 'GET',
		path: '/vendors',
		auth: false,
		query: [
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
		tests: `
pm.test('200', () => pm.response.to.have.status(200));
const j = pm.response.json();
if (j.vendors && j.vendors[0]) pm.environment.set('vendorId', String(j.vendors[0].id));
`,
	}),
	req({
		name: 'GET Vendor storefront',
		method: 'GET',
		path: '/vendors/{{vendorId}}/storefront',
		auth: false,
		tests: `
pm.test('200', () => pm.response.to.have.status(200));
const j = pm.response.json();
const items = j.items || [];
if (items[0] && items[0].listing_id) pm.environment.set('listingId', String(items[0].listing_id));
`,
	}),
];

const customer = [
	req({
		name: 'GET Addresses list',
		method: 'GET',
		path: '/addresses',
		auth: 'customerToken',
	}),
	req({
		name: 'POST Addresses create',
		method: 'POST',
		path: '/addresses',
		auth: 'customerToken',
		body: {
			label: 'Home',
			lat: 19.076,
			lng: 72.8777,
			pincode: '400001',
			street: 'Demo Street',
			is_default: true,
		},
		tests: `
pm.test('created', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
const j = pm.response.json();
const a = j.address || j;
if (a.id) pm.environment.set('addressId', String(a.id));
`,
	}),
	req({
		name: 'GET Addresses geocode search',
		method: 'GET',
		path: '/addresses/geocode/search',
		auth: 'customerToken',
		query: [{ key: 'q', value: 'Andheri Mumbai' }],
	}),
	req({
		name: 'GET Addresses geocode reverse',
		method: 'GET',
		path: '/addresses/geocode/reverse',
		auth: 'customerToken',
		query: [
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
	}),
	req({
		name: 'GET Addresses places autocomplete',
		method: 'GET',
		path: '/addresses/places/autocomplete',
		auth: 'customerToken',
		query: [
			{ key: 'q', value: 'Bandra' },
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
	}),
	req({
		name: 'GET Addresses place details',
		method: 'GET',
		path: '/addresses/places/{{placeId}}',
		auth: 'customerToken',
		description: 'Set placeId from autocomplete.',
	}),
	req({
		name: 'GET Address by id',
		method: 'GET',
		path: '/addresses/{{addressId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'PATCH Address',
		method: 'PATCH',
		path: '/addresses/{{addressId}}',
		auth: 'customerToken',
		body: { landmark: 'Near park' },
	}),
	req({
		name: 'PUT Address',
		method: 'PUT',
		path: '/addresses/{{addressId}}',
		auth: 'customerToken',
		body: {
			label: 'Home',
			lat: 19.076,
			lng: 72.8777,
			street: 'Demo Street Updated',
		},
	}),
	req({
		name: 'PUT Address set default',
		method: 'PUT',
		path: '/addresses/{{addressId}}/default',
		auth: 'customerToken',
	}),
	req({
		name: 'DELETE Address',
		method: 'DELETE',
		path: '/addresses/{{addressId}}',
		auth: 'customerToken',
		description: 'Destructive — recreate address after testing.',
	}),
	req({
		name: 'GET Delivery quote',
		method: 'GET',
		path: '/orders/delivery-quote',
		auth: 'customerToken',
		query: [
			{ key: 'vendor_id', value: '{{vendorId}}' },
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
	}),
	req({
		name: 'POST Place order (COD)',
		method: 'POST',
		path: '/orders',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2,8));`,
		body: {
			vendor_id: '{{vendorId}}',
			fulfillment_mode: 'self',
			payment_method: 'cod',
			items: [{ listing_id: '{{listingId}}', qty: 1 }],
			delivery_address: { lat: 19.076, lng: 72.8777, line1: 'Home' },
		},
		tests: `
pm.test('created', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
const j = pm.response.json();
if (j.order && j.order.id) pm.environment.set('orderId', String(j.order.id));
`,
	}),
	req({
		name: 'GET My orders',
		method: 'GET',
		path: '/orders/me',
		auth: 'customerToken',
	}),
	req({
		name: 'GET Order by id',
		method: 'GET',
		path: '/orders/{{orderId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'GET Order tracking',
		method: 'GET',
		path: '/orders/{{orderId}}/tracking',
		auth: 'customerToken',
	}),
	req({
		name: 'GET Order events',
		method: 'GET',
		path: '/orders/{{orderId}}/events',
		auth: 'customerToken',
	}),
	req({
		name: 'POST Payment create COD',
		method: 'POST',
		path: '/payment/create',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'pay_' + Date.now());`,
		body: { order_id: '{{orderId}}', provider: 'cod' },
	}),
	req({
		name: 'POST Payment create Razorpay',
		method: 'POST',
		path: '/payment/create',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'pay_rzp_' + Date.now());`,
		body: { order_id: '{{orderId}}', provider: 'razorpay' },
		description: 'Needs RAZORPAY_KEY_ID/SECRET. On success sets razorpayOrderId.',
		tests: `
const j = pm.response.json();
if (j.razorpay && j.razorpay.razorpay_order_id) {
  pm.environment.set('razorpayOrderId', j.razorpay.razorpay_order_id);
}
`,
	}),
	req({
		name: 'POST Payment verify',
		method: 'POST',
		path: '/payment/verify',
		auth: 'customerToken',
		body: {
			order_id: '{{orderId}}',
			razorpay_order_id: '{{razorpayOrderId}}',
			razorpay_payment_id: 'pay_test',
			razorpay_signature: 'invalid',
		},
		description: 'Replace with real SDK values after checkout.',
	}),
	req({
		name: 'POST Devices register',
		method: 'POST',
		path: '/devices/register',
		auth: 'customerToken',
		body: { expo_push_token: 'ExponentPushToken[test-postman]', platform: 'ios' },
	}),
	req({
		name: 'DELETE Devices unregister',
		method: 'DELETE',
		path: '/devices/register',
		auth: 'customerToken',
		body: { expo_push_token: 'ExponentPushToken[test-postman]' },
	}),
	req({
		name: 'POST Devices push (self)',
		method: 'POST',
		path: '/devices/push',
		auth: 'customerToken',
		body: { title: 'Test', body: 'Hello from Postman' },
	}),
	req({
		name: 'GET Ledger me',
		method: 'GET',
		path: '/ledger/me',
		auth: 'customerToken',
	}),
	req({
		name: 'POST Lists create',
		method: 'POST',
		path: '/lists',
		auth: 'customerToken',
		body: { name: 'Weekly groceries', list_type: 'shopping' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200, 201]);
const j = pm.response.json();
const list = j.list || j;
if (list.id) pm.environment.set('listId', String(list.id));
`,
	}),
	req({
		name: 'GET Lists',
		method: 'GET',
		path: '/lists',
		auth: 'customerToken',
	}),
	req({
		name: 'GET List by id',
		method: 'GET',
		path: '/lists/{{listId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'PATCH List',
		method: 'PATCH',
		path: '/lists/{{listId}}',
		auth: 'customerToken',
		body: { name: 'Weekly groceries (updated)' },
	}),
	req({
		name: 'POST List add item',
		method: 'POST',
		path: '/lists/{{listId}}/items',
		auth: 'customerToken',
		body: { master_product_id: '{{masterProductId}}', qty: 2 },
		tests: `
const j = pm.response.json();
const item = j.item || (j.items && j.items[0]);
if (item && item.id) pm.environment.set('listItemId', String(item.id));
`,
	}),
	req({
		name: 'PATCH List item',
		method: 'PATCH',
		path: '/lists/{{listId}}/items/{{listItemId}}',
		auth: 'customerToken',
		body: { qty: 3 },
	}),
	req({
		name: 'DELETE List item',
		method: 'DELETE',
		path: '/lists/{{listId}}/items/{{listItemId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'POST List members',
		method: 'POST',
		path: '/lists/{{listId}}/members',
		auth: 'customerToken',
		body: { phone: '{{vendorPhone}}', role: 'editor' },
		description: 'May fail if phone not a customer — edge case.',
	}),
	req({
		name: 'DELETE List member',
		method: 'DELETE',
		path: '/lists/{{listId}}/members/{{memberUserId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'POST List checkout preview',
		method: 'POST',
		path: '/lists/{{listId}}/checkout/preview',
		auth: 'customerToken',
		body: { lat: 19.076, lng: 72.8777 },
		tests: `
const j = pm.response.json();
if (j.preview_token) pm.environment.set('previewToken', j.preview_token);
`,
	}),
	req({
		name: 'POST List checkout',
		method: 'POST',
		path: '/lists/{{listId}}/checkout',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'list_co_' + Date.now());`,
		body: { preview_token: '{{previewToken}}', payment_method: 'cod' },
	}),
	req({
		name: 'POST List archive',
		method: 'POST',
		path: '/lists/{{listId}}/archive',
		auth: 'customerToken',
	}),
	req({
		name: 'POST Disputes open',
		method: 'POST',
		path: '/disputes',
		auth: 'customerToken',
		body: { order_id: '{{orderId}}', reason: 'Item missing', against_role: 'vendor' },
		tests: `
const j = pm.response.json();
if (j.dispute && j.dispute.id) pm.environment.set('disputeId', String(j.dispute.id));
`,
	}),
	req({
		name: 'GET Disputes',
		method: 'GET',
		path: '/disputes',
		auth: 'customerToken',
	}),
	req({
		name: 'GET Dispute by id',
		method: 'GET',
		path: '/disputes/{{disputeId}}',
		auth: 'customerToken',
	}),
	req({
		name: 'GET Reviews me',
		method: 'GET',
		path: '/reviews/me',
		auth: 'customerToken',
	}),
	req({
		name: 'POST Reviews create',
		method: 'POST',
		path: '/reviews',
		auth: 'customerToken',
		body: { order_id: '{{orderId}}', rating: 5, body: 'Great' },
		description: 'Order must be delivered.',
	}),
	req({
		name: 'POST Services booking',
		method: 'POST',
		path: '/services/bookings',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'bk_' + Date.now());`,
		body: {
			vendor_service_id: '{{vendorServiceId}}',
			scheduled_start: '2030-01-15T10:00:00.000Z',
			notes: 'Postman booking',
		},
		tests: `
const j = pm.response.json();
if (j.booking && j.booking.id) pm.environment.set('bookingId', String(j.booking.id));
`,
	}),
	req({
		name: 'GET Services bookings me',
		method: 'GET',
		path: '/services/bookings/me',
		auth: 'customerToken',
	}),
];

const vendor = [
	req({
		name: 'POST Vendor apply',
		method: 'POST',
		path: '/vendors/me/apply',
		auth: 'customerToken',
		body: {
			business_name: 'New Shop',
			lat: 19.076,
			lng: 72.8777,
			vendor_type: 'kirana',
		},
		description: 'Converts user to vendor pending approval — use carefully on seed customer.',
	}),
	req({
		name: 'GET Vendor me',
		method: 'GET',
		path: '/vendors/me',
		auth: 'vendorToken',
		tests: `
pm.test('200', () => pm.response.to.have.status(200));
const j = pm.response.json();
if (j.vendor && j.vendor.id) pm.environment.set('vendorId', String(j.vendor.id));
`,
	}),
	req({
		name: 'PATCH Vendor me (open)',
		method: 'PATCH',
		path: '/vendors/me',
		auth: 'vendorToken',
		body: { is_open: true },
	}),
	req({
		name: 'PATCH Vendor me (closed)',
		method: 'PATCH',
		path: '/vendors/me',
		auth: 'vendorToken',
		body: { is_open: false },
	}),
	req({
		name: 'GET Vendor listings',
		method: 'GET',
		path: '/vendors/me/listings',
		auth: 'vendorToken',
		tests: `
const j = pm.response.json();
const L = j.listings || [];
if (L[0]) {
  pm.environment.set('listingId', String(L[0].id));
  if (L[0].master_product_id) pm.environment.set('masterProductId', String(L[0].master_product_id));
}
`,
	}),
	req({
		name: 'POST Vendor listing',
		method: 'POST',
		path: '/vendors/me/listings',
		auth: 'vendorToken',
		body: { master_product_id: '{{masterProductId}}', price_paise: 3500, qty: 10 },
	}),
	req({
		name: 'PATCH Vendor listing',
		method: 'PATCH',
		path: '/vendors/me/listings/{{listingId}}',
		auth: 'vendorToken',
		body: { price_paise: 3600, is_active: true },
	}),
	req({
		name: 'PATCH Vendor inventory',
		method: 'PATCH',
		path: '/vendors/me/inventory/{{listingId}}',
		auth: 'vendorToken',
		body: { qty: 25 },
	}),
	req({
		name: 'POST Vendor proposal',
		method: 'POST',
		path: '/vendors/me/proposals',
		auth: 'vendorToken',
		body: { name: 'Local Snack Pack', category: 'snacks', suggested_price_paise: 2000 },
	}),
	req({
		name: 'GET Vendor proposals',
		method: 'GET',
		path: '/vendors/me/proposals',
		auth: 'vendorToken',
	}),
	req({
		name: 'GET Vendor orders',
		method: 'GET',
		path: '/orders/vendor',
		auth: 'vendorToken',
		tests: `
const j = pm.response.json();
const o = (j.orders || []).find(x => x.status === 'placed') || (j.orders || [])[0];
if (o) pm.environment.set('orderId', String(o.id));
`,
	}),
	req({
		name: 'POST Order accept',
		method: 'POST',
		path: '/orders/{{orderId}}/accept',
		auth: 'vendorToken',
	}),
	req({
		name: 'POST Order reject',
		method: 'POST',
		path: '/orders/{{orderId}}/reject',
		auth: 'vendorToken',
		body: { reason: 'Out of stock' },
		description: 'Only for placed orders you intend to reject.',
	}),
	req({
		name: 'POST Order status alias',
		method: 'POST',
		path: '/orders/{{orderId}}/status',
		auth: 'vendorToken',
		body: { to_status: 'preparing' },
	}),
	req({
		name: 'POST Order transition preparing',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'preparing' },
	}),
	req({
		name: 'POST Order transition ready',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'ready' },
		tests: `
const j = pm.response.json();
if (j.delivery_otp) pm.environment.set('deliveryOtp', j.delivery_otp);
`,
	}),
	req({
		name: 'GET Services me (vendor)',
		method: 'GET',
		path: '/services/me',
		auth: 'vendorToken',
		tests: `
const j = pm.response.json();
const s = j.services || [];
if (s[0]) pm.environment.set('vendorServiceId', String(s[0].id));
`,
	}),
	req({
		name: 'POST Services me upsert',
		method: 'POST',
		path: '/services/me',
		auth: 'vendorToken',
		body: {
			title: 'AC Service Visit',
			price_paise: 49900,
			duration_minutes: 60,
		},
	}),
	req({
		name: 'GET Services bookings vendor',
		method: 'GET',
		path: '/services/bookings/vendor',
		auth: 'vendorToken',
	}),
	req({
		name: 'POST Booking transition',
		method: 'POST',
		path: '/services/bookings/{{bookingId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'accepted' },
	}),
	req({
		name: 'GET Ledger me (vendor)',
		method: 'GET',
		path: '/ledger/me',
		auth: 'vendorToken',
	}),
];

const delivery = [
	req({
		name: 'GET Delivery me',
		method: 'GET',
		path: '/delivery/me',
		auth: 'deliveryToken',
	}),
	req({
		name: 'PATCH Delivery location',
		method: 'PATCH',
		path: '/delivery/me/location',
		auth: 'deliveryToken',
		body: { lat: 19.076, lng: 72.8777 },
	}),
	req({
		name: 'GET Delivery jobs',
		method: 'GET',
		path: '/delivery/jobs',
		auth: 'deliveryToken',
		tests: `
const j = pm.response.json();
const job = (j.jobs || []).find(x => x.status === 'unassigned') || (j.jobs || [])[0];
if (job) pm.environment.set('jobId', String(job.id));
`,
	}),
	req({
		name: 'GET Delivery jobs filtered',
		method: 'GET',
		path: '/delivery/jobs',
		auth: 'deliveryToken',
		query: [{ key: 'status', value: 'unassigned' }],
	}),
	req({
		name: 'POST Job accept',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/accept',
		auth: 'deliveryToken',
	}),
	req({
		name: 'POST Job pickup',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/pickup',
		auth: 'deliveryToken',
	}),
	req({
		name: 'POST Job complete',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/complete',
		auth: 'deliveryToken',
		body: { delivery_otp: '{{deliveryOtp}}' },
	}),
];

const admin = [
	req({
		name: 'GET Admin stats',
		method: 'GET',
		path: '/admin/stats',
		auth: 'adminToken',
	}),
	req({
		name: 'GET Admin vendors',
		method: 'GET',
		path: '/admin/vendors',
		auth: 'adminToken',
		query: [{ key: 'approved', value: 'false' }],
	}),
	req({
		name: 'POST Admin vendor approve',
		method: 'POST',
		path: '/admin/vendors/{{vendorId}}/approve',
		auth: 'adminToken',
	}),
	req({
		name: 'POST Admin vendor reject',
		method: 'POST',
		path: '/admin/vendors/{{vendorId}}/reject',
		auth: 'adminToken',
	}),
	req({
		name: 'GET Admin users',
		method: 'GET',
		path: '/admin/users',
		auth: 'adminToken',
		query: [{ key: 'q', value: '9111' }],
	}),
	req({
		name: 'POST Admin user deactivate',
		method: 'POST',
		path: '/admin/users/{{targetUserId}}/deactivate',
		auth: 'adminToken',
		description: 'Destructive — do not run on seed admin.',
	}),
	req({
		name: 'POST Admin catalog master',
		method: 'POST',
		path: '/admin/catalog/master',
		auth: 'adminToken',
		body: { name: 'Test Product', brand: 'Grabit', category: 'grocery', unit_label: '1kg' },
	}),
	req({
		name: 'PATCH Admin catalog master',
		method: 'PATCH',
		path: '/admin/catalog/master/{{masterProductId}}',
		auth: 'adminToken',
		body: { brand: 'Grabit Updated' },
	}),
	req({
		name: 'POST Admin catalog images',
		method: 'POST',
		path: '/admin/catalog/master/{{masterProductId}}/images',
		auth: 'adminToken',
		body: { images: [] },
		description: 'Or multipart field images / base64 data URLs.',
	}),
	req({
		name: 'DELETE Admin catalog images',
		method: 'DELETE',
		path: '/admin/catalog/master/{{masterProductId}}/images',
		auth: 'adminToken',
		body: { url: '{{imageUrl}}' },
	}),
	req({
		name: 'GET Admin catalog categories',
		method: 'GET',
		path: '/admin/catalog/categories',
		auth: 'adminToken',
	}),
	req({
		name: 'GET Admin catalog brands',
		method: 'GET',
		path: '/admin/catalog/brands',
		auth: 'adminToken',
	}),
	req({
		name: 'GET Admin catalog master list',
		method: 'GET',
		path: '/admin/catalog/master',
		auth: 'adminToken',
		query: [{ key: 'q', value: 'Amul' }],
		tests: `
const j = pm.response.json();
const rows = j.products || j.items || [];
if (rows[0] && rows[0].id) pm.environment.set('masterProductId', String(rows[0].id));
`,
	}),
	req({
		name: 'GET Admin proposals',
		method: 'GET',
		path: '/admin/proposals',
		auth: 'adminToken',
	}),
	req({
		name: 'POST Admin proposal approve',
		method: 'POST',
		path: '/admin/proposals/{{proposalId}}/approve',
		auth: 'adminToken',
	}),
	req({
		name: 'POST Admin proposal reject',
		method: 'POST',
		path: '/admin/proposals/{{proposalId}}/reject',
		auth: 'adminToken',
	}),
	req({
		name: 'GET Admin orders',
		method: 'GET',
		path: '/admin/orders',
		auth: 'adminToken',
		query: [{ key: 'status', value: 'placed' }],
	}),
	req({
		name: 'POST Admin order transition',
		method: 'POST',
		path: '/admin/orders/{{orderId}}/transition',
		auth: 'adminToken',
		body: { to_status: 'accepted', reason: 'staff override' },
	}),
	req({
		name: 'GET Admin settings',
		method: 'GET',
		path: '/admin/settings',
		auth: 'adminToken',
	}),
	req({
		name: 'PUT Admin setting',
		method: 'PUT',
		path: '/admin/settings/delivery_fee_paise',
		auth: 'adminToken',
		body: { value: 2000 },
	}),
	req({
		name: 'PUT Admin info page',
		method: 'PUT',
		path: '/admin/info-pages/about',
		auth: 'adminToken',
		body: { title: 'About Grabit', body: 'Hyperlocal commerce' },
	}),
	req({
		name: 'GET Analytics pilot',
		method: 'GET',
		path: '/analytics/pilot',
		auth: 'adminToken',
		query: [{ key: 'days', value: '14' }],
	}),
	req({
		name: 'GET Analytics events',
		method: 'GET',
		path: '/analytics/events',
		auth: 'adminToken',
	}),
	req({
		name: 'POST Dispute resolve',
		method: 'POST',
		path: '/disputes/{{disputeId}}/resolve',
		auth: 'adminToken',
		body: { status: 'resolved', resolution: 'Refunded goodwill', issue_refund: false },
	}),
	req({
		name: 'POST Verification schedule',
		method: 'POST',
		path: '/verification/schedule',
		auth: 'adminToken',
		body: {
			vendor_id: '{{vendorId}}',
			field_agent_id: '{{fieldUserId}}',
			checklist: { storefront: true },
		},
	}),
	req({
		name: 'GET Verification list',
		method: 'GET',
		path: '/verification',
		auth: 'adminToken',
		query: [{ key: 'status', value: 'scheduled' }],
	}),
	req({
		name: 'PATCH Verification',
		method: 'PATCH',
		path: '/verification/{{verificationId}}',
		auth: 'fieldToken',
		body: { status: 'passed', notes: 'OK', checklist: { stock: true } },
	}),
	req({
		name: 'POST Services master create',
		method: 'POST',
		path: '/services/master',
		auth: 'adminToken',
		body: { name: 'Plumbing Visit', category: 'home', unit_label: 'visit' },
	}),
	req({
		name: 'POST Payment refund',
		method: 'POST',
		path: '/payment/refund',
		auth: 'adminToken',
		body: { order_id: '{{orderId}}', reason: 'dispute' },
	}),
	req({
		name: 'POST Payment settle commission',
		method: 'POST',
		path: '/payment/settle-commission',
		auth: 'adminToken',
		body: { order_id: '{{orderId}}' },
	}),
	req({
		name: 'GET Ledger account',
		method: 'GET',
		path: '/ledger/account/{{ledgerAccountRef}}',
		auth: 'adminToken',
		description: 'URL-encode ref if it contains special chars.',
	}),
	req({
		name: 'POST Payment webhook (Razorpay)',
		method: 'POST',
		path: '/payment/webhook',
		auth: false,
		headers: [{ key: 'X-Razorpay-Signature', value: 'invalid' }],
		body: { event: 'payment.captured', payload: {} },
		description: 'No JWT. Signature validated when RAZORPAY_WEBHOOK_SECRET set.',
	}),
];

// ─── Flows ─────────────────────────────────────────────────────────────────

const flowA = [
	req({
		name: 'A1 Customer send-otp',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{customerPhone}}' },
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200,201]);
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('customerOtp', j.dev_otp);
`,
	}),
	req({
		name: 'A2 Customer verify-otp',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{customerPhone}}', otp: '{{customerOtp}}' },
		tests: saveToken('customerPhone', 'customerToken'),
	}),
	req({
		name: 'A3 Vendor send+verify',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{vendorPhone}}' },
		tests: `
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('vendorOtp', j.dev_otp);
`,
	}),
	req({
		name: 'A3b Vendor verify-otp',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{vendorPhone}}', otp: '{{vendorOtp}}' },
		tests: saveToken('vendorPhone', 'vendorToken'),
	}),
	req({
		name: 'A4 List vendors + storefront',
		method: 'GET',
		path: '/vendors',
		auth: false,
		query: [
			{ key: 'lat', value: '{{lat}}' },
			{ key: 'lng', value: '{{lng}}' },
		],
		tests: `
const j = pm.response.json();
if (j.vendors && j.vendors[0]) pm.environment.set('vendorId', String(j.vendors[0].id));
`,
	}),
	req({
		name: 'A4b Storefront',
		method: 'GET',
		path: '/vendors/{{vendorId}}/storefront',
		auth: false,
		tests: `
const j = pm.response.json();
if (j.items && j.items[0]) pm.environment.set('listingId', String(j.items[0].listing_id));
`,
	}),
	req({
		name: 'A5 Place COD self order',
		method: 'POST',
		path: '/orders',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'flowA_' + Date.now());`,
		body: {
			vendor_id: '{{vendorId}}',
			fulfillment_mode: 'self',
			payment_method: 'cod',
			items: [{ listing_id: '{{listingId}}', qty: 1 }],
			delivery_address: { lat: 19.076, lng: 72.8777, line1: 'Flow A Home' },
		},
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200,201]);
pm.environment.set('orderId', String(pm.response.json().order.id));
`,
	}),
	req({
		name: 'A6 Vendor accept',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'accepted' },
	}),
	req({
		name: 'A7 Vendor preparing',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'preparing' },
	}),
	req({
		name: 'A8 Vendor ready (capture OTP)',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'ready' },
		tests: `
const j = pm.response.json();
if (j.delivery_otp) pm.environment.set('deliveryOtp', j.delivery_otp);
`,
	}),
	req({
		name: 'A9 Vendor picked',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'picked' },
	}),
	req({
		name: 'A10 Vendor delivered + OTP',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'delivered', delivery_otp: '{{deliveryOtp}}' },
	}),
	req({
		name: 'A11 Customer tracking',
		method: 'GET',
		path: '/orders/{{orderId}}/tracking',
		auth: 'customerToken',
	}),
];

const flowB = [
	req({
		name: 'B1 Auth customer+vendor+delivery',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{customerPhone}}' },
		description: 'Run verify requests in 00 Auth first, or chain manually.',
		tests: `
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('customerOtp', j.dev_otp);
`,
	}),
	req({
		name: 'B1b Verify customer',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{customerPhone}}', otp: '{{customerOtp}}' },
		tests: saveToken('customerPhone', 'customerToken'),
	}),
	req({
		name: 'B2 Place partner order',
		method: 'POST',
		path: '/orders',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'flowB_' + Date.now());`,
		body: {
			vendor_id: '{{vendorId}}',
			fulfillment_mode: 'partner',
			payment_method: 'cod',
			items: [{ listing_id: '{{listingId}}', qty: 1 }],
			delivery_address: { lat: 19.078, lng: 72.88, line1: 'Flow B Drop' },
		},
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200,201]);
pm.environment.set('orderId', String(pm.response.json().order.id));
`,
	}),
	req({
		name: 'B3 Vendor → ready',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'accepted' },
		description: 'Then run preparing + ready manually if needed; next requests assume ready.',
	}),
	req({
		name: 'B3b preparing',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'preparing' },
	}),
	req({
		name: 'B3c ready + OTP + job',
		method: 'POST',
		path: '/orders/{{orderId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'ready' },
		tests: `
const j = pm.response.json();
if (j.delivery_otp) pm.environment.set('deliveryOtp', j.delivery_otp);
`,
	}),
	req({
		name: 'B4 Delivery login',
		method: 'POST',
		path: '/auth/send-otp',
		auth: false,
		body: { phone: '{{deliveryPhone}}' },
		tests: `
const j = pm.response.json();
if (j.dev_otp) pm.environment.set('deliveryOtpLogin', j.dev_otp);
`,
	}),
	req({
		name: 'B4b Delivery verify',
		method: 'POST',
		path: '/auth/verify-otp',
		auth: false,
		body: { phone: '{{deliveryPhone}}', otp: '{{deliveryOtpLogin}}' },
		tests: saveToken('deliveryPhone', 'deliveryToken'),
	}),
	req({
		name: 'B5 List jobs',
		method: 'GET',
		path: '/delivery/jobs',
		auth: 'deliveryToken',
		tests: `
const j = pm.response.json();
const job = (j.jobs || []).find(x => String(x.order_id) === pm.environment.get('orderId'))
  || (j.jobs || []).find(x => x.status === 'unassigned');
if (job) pm.environment.set('jobId', String(job.id));
`,
	}),
	req({
		name: 'B6 Accept job',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/accept',
		auth: 'deliveryToken',
	}),
	req({
		name: 'B7 Pickup',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/pickup',
		auth: 'deliveryToken',
	}),
	req({
		name: 'B8 Ping location',
		method: 'PATCH',
		path: '/delivery/me/location',
		auth: 'deliveryToken',
		body: { lat: 19.077, lng: 72.879 },
	}),
	req({
		name: 'B9 Complete with door OTP',
		method: 'POST',
		path: '/delivery/jobs/{{jobId}}/complete',
		auth: 'deliveryToken',
		body: { delivery_otp: '{{deliveryOtp}}' },
	}),
	req({
		name: 'B10 Customer tracking',
		method: 'GET',
		path: '/orders/{{orderId}}/tracking',
		auth: 'customerToken',
	}),
];

const flowC = [
	req({
		name: 'C1 GET services master',
		method: 'GET',
		path: '/services/master',
		auth: false,
	}),
	req({
		name: 'C2 GET vendor services',
		method: 'GET',
		path: '/services/vendor/{{vendorId}}',
		auth: false,
		tests: `
const j = pm.response.json();
if (j.services && j.services[0]) pm.environment.set('vendorServiceId', String(j.services[0].id));
`,
	}),
	req({
		name: 'C3 Create booking',
		method: 'POST',
		path: '/services/bookings',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'flowC_' + Date.now());`,
		body: {
			vendor_service_id: '{{vendorServiceId}}',
			scheduled_start: '2030-06-01T09:00:00.000Z',
		},
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200,201]);
pm.environment.set('bookingId', String(pm.response.json().booking.id));
`,
	}),
	req({
		name: 'C4 Vendor accept booking',
		method: 'POST',
		path: '/services/bookings/{{bookingId}}/transition',
		auth: 'vendorToken',
		body: { to_status: 'accepted' },
	}),
];

const flowD = [
	req({
		name: 'D1 Create list',
		method: 'POST',
		path: '/lists',
		auth: 'customerToken',
		body: { name: 'Flow D List' },
		tests: `
pm.environment.set('listId', String((pm.response.json().list || pm.response.json()).id));
`,
	}),
	req({
		name: 'D2 Ensure masterProductId',
		method: 'GET',
		path: '/catalog/master/search',
		auth: false,
		query: [{ key: 'q', value: 'Amul' }],
		tests: `
const j = pm.response.json();
const rows = j.products || j.items || [];
if (rows[0]) pm.environment.set('masterProductId', String(rows[0].id));
`,
	}),
	req({
		name: 'D3 Add item',
		method: 'POST',
		path: '/lists/{{listId}}/items',
		auth: 'customerToken',
		body: { master_product_id: '{{masterProductId}}', qty: 1 },
	}),
	req({
		name: 'D4 Preview checkout',
		method: 'POST',
		path: '/lists/{{listId}}/checkout/preview',
		auth: 'customerToken',
		body: { lat: 19.076, lng: 72.8777 },
		tests: `
const j = pm.response.json();
if (j.preview_token) pm.environment.set('previewToken', j.preview_token);
`,
	}),
	req({
		name: 'D5 Checkout',
		method: 'POST',
		path: '/lists/{{listId}}/checkout',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'flowD_' + Date.now());`,
		body: { preview_token: '{{previewToken}}', payment_method: 'cod' },
	}),
];

const flowE = [
	req({
		name: 'E1 Place order for Razorpay',
		method: 'POST',
		path: '/orders',
		auth: 'customerToken',
		idempotency: true,
		prerequest: `pm.environment.set('idempotencyKey', 'flowE_' + Date.now());`,
		body: {
			vendor_id: '{{vendorId}}',
			payment_method: 'razorpay',
			items: [{ listing_id: '{{listingId}}', qty: 1 }],
		},
		tests: `
pm.expect(pm.response.code).to.be.oneOf([200,201]);
pm.environment.set('orderId', String(pm.response.json().order.id));
`,
	}),
	req({
		name: 'E2 Payment create razorpay',
		method: 'POST',
		path: '/payment/create',
		auth: 'customerToken',
		body: { order_id: '{{orderId}}', provider: 'razorpay' },
		description:
			'Expected 201 with razorpay block when keys set; else 4xx with hint. Complete Checkout in app, then verify.',
		tests: expectStatusOneOf([200, 201, 400, 502, 503], 'keys may be missing'),
	}),
];

// ─── Negatives ─────────────────────────────────────────────────────────────

const negatives = [
	folder('Auth', [
		req({
			name: 'NEG send-otp invalid phone',
			method: 'POST',
			path: '/auth/send-otp',
			auth: false,
			body: { phone: '123' },
			description: 'Expected 400',
			tests: expectStatusOneOf([400, 422]),
		}),
		req({
			name: 'NEG verify wrong OTP',
			method: 'POST',
			path: '/auth/verify-otp',
			auth: false,
			body: { phone: '{{customerPhone}}', otp: '000000' },
			description: 'Expected 400/401',
			tests: expectStatusOneOf([400, 401]),
		}),
		req({
			name: 'NEG refresh invalid token',
			method: 'POST',
			path: '/auth/refresh',
			auth: false,
			body: { refreshToken: 'not-a-token' },
			tests: expectStatusOneOf([400, 401]),
		}),
		req({
			name: 'NEG me without Bearer',
			method: 'GET',
			path: '/auth/me',
			auth: false,
			description: 'Expected 401',
			tests: expectStatus(401),
		}),
		req({
			name: 'NEG OTP rate limit (manual burst)',
			method: 'POST',
			path: '/auth/send-otp',
			auth: false,
			body: { phone: '{{customerPhone}}' },
			description: 'Run 6+ times quickly — expect 429 after OTP_RATE_MAX.',
			tests: expectStatusOneOf([200, 201, 429]),
		}),
	]),
	folder('Orders', [
		req({
			name: 'NEG place order missing Idempotency-Key',
			method: 'POST',
			path: '/orders',
			auth: 'customerToken',
			body: {
				vendor_id: '{{vendorId}}',
				items: [{ listing_id: '{{listingId}}', qty: 1 }],
			},
			description: 'Expected 400 — Idempotency-Key required',
			tests: expectStatus(400),
		}),
		req({
			name: 'NEG invalid transition',
			method: 'POST',
			path: '/orders/{{orderId}}/transition',
			auth: 'vendorToken',
			body: { to_status: 'delivered' },
			description: 'From placed/wrong state — expected 400',
			tests: expectStatusOneOf([400, 409]),
		}),
		req({
			name: 'NEG oversell qty',
			method: 'POST',
			path: '/orders',
			auth: 'customerToken',
			idempotency: true,
			prerequest: `pm.environment.set('idempotencyKey', 'neg_stock_' + Date.now());`,
			body: {
				vendor_id: '{{vendorId}}',
				items: [{ listing_id: '{{listingId}}', qty: 999999 }],
			},
			description: 'Expected 409 STOCK_*',
			tests: expectStatusOneOf([400, 409]),
		}),
		req({
			name: 'NEG delivery uses order transition',
			method: 'POST',
			path: '/orders/{{orderId}}/transition',
			auth: 'deliveryToken',
			body: { to_status: 'picked' },
			description: 'Expected 403 USE_DELIVERY_JOB',
			tests: expectStatus(403),
		}),
		req({
			name: 'NEG duplicate Idempotency-Key replay',
			method: 'POST',
			path: '/orders',
			auth: 'customerToken',
			headers: [{ key: 'Idempotency-Key', value: 'fixed-replay-key-postman-001' }],
			body: {
				vendor_id: '{{vendorId}}',
				items: [{ listing_id: '{{listingId}}', qty: 1 }],
			},
			description: 'Run twice — second should replay same order (200/201), not create new.',
			tests: expectStatusOneOf([200, 201, 409]),
		}),
	]),
	folder('Delivery', [
		req({
			name: 'NEG complete wrong OTP',
			method: 'POST',
			path: '/delivery/jobs/{{jobId}}/complete',
			auth: 'deliveryToken',
			body: { delivery_otp: '000000' },
			tests: expectStatusOneOf([400, 409]),
		}),
		req({
			name: 'NEG accept already assigned',
			method: 'POST',
			path: '/delivery/jobs/{{jobId}}/accept',
			auth: 'deliveryToken',
			description: 'Second accept on same job — expected 409',
			tests: expectStatusOneOf([400, 409]),
		}),
		req({
			name: 'NEG location missing coords',
			method: 'PATCH',
			path: '/delivery/me/location',
			auth: 'deliveryToken',
			body: {},
			tests: expectStatus(400),
		}),
	]),
	folder('RBAC', [
		req({
			name: 'NEG customer → delivery jobs',
			method: 'GET',
			path: '/delivery/jobs',
			auth: 'customerToken',
			tests: expectStatus(403),
		}),
		req({
			name: 'NEG vendor → admin stats',
			method: 'GET',
			path: '/admin/stats',
			auth: 'vendorToken',
			tests: expectStatus(403),
		}),
		req({
			name: 'NEG customer → analytics',
			method: 'GET',
			path: '/analytics/pilot',
			auth: 'customerToken',
			tests: expectStatus(403),
		}),
	]),
	folder('Addresses Payment Bookings Lists', [
		req({
			name: 'NEG geocode without auth',
			method: 'GET',
			path: '/addresses/geocode/search',
			auth: false,
			query: [{ key: 'q', value: 'Mumbai' }],
			tests: expectStatus(401),
		}),
		req({
			name: 'NEG reverse bad lat',
			method: 'GET',
			path: '/addresses/geocode/reverse',
			auth: 'customerToken',
			query: [
				{ key: 'lat', value: 'not-a-number' },
				{ key: 'lng', value: '72.8' },
			],
			tests: expectStatusOneOf([400, 500]),
		}),
		req({
			name: 'NEG payment verify bad signature',
			method: 'POST',
			path: '/payment/verify',
			auth: 'customerToken',
			body: {
				order_id: '{{orderId}}',
				razorpay_order_id: 'order_x',
				razorpay_payment_id: 'pay_x',
				razorpay_signature: 'bad',
			},
			tests: expectStatusOneOf([400, 401, 404]),
		}),
		req({
			name: 'NEG webhook bad signature',
			method: 'POST',
			path: '/payment/webhook',
			auth: false,
			headers: [{ key: 'X-Razorpay-Signature', value: 'bad' }],
			body: { event: 'payment.captured' },
			tests: expectStatusOneOf([400, 200]),
		}),
		req({
			name: 'NEG booking missing Idempotency-Key',
			method: 'POST',
			path: '/services/bookings',
			auth: 'customerToken',
			body: {
				vendor_service_id: '{{vendorServiceId}}',
				scheduled_start: '2030-01-01T10:00:00.000Z',
			},
			tests: expectStatus(400),
		}),
		req({
			name: 'NEG booking slot conflict',
			method: 'POST',
			path: '/services/bookings',
			auth: 'customerToken',
			idempotency: true,
			prerequest: `pm.environment.set('idempotencyKey', 'conflict_' + Date.now());`,
			body: {
				vendor_service_id: '{{vendorServiceId}}',
				scheduled_start: '2030-06-01T09:00:00.000Z',
			},
			description: 'After Flow C booking at same slot — expect 409 SLOT_CONFLICT',
			tests: expectStatusOneOf([201, 409]),
		}),
		req({
			name: 'NEG list checkout without preview_token',
			method: 'POST',
			path: '/lists/{{listId}}/checkout',
			auth: 'customerToken',
			idempotency: true,
			prerequest: `pm.environment.set('idempotencyKey', 'neg_list_' + Date.now());`,
			body: { payment_method: 'cod' },
			tests: expectStatusOneOf([400, 422]),
		}),
	]),
];

// ─── Assemble collection ───────────────────────────────────────────────────

const collection = {
	info: {
		_postman_id: uid(),
		name: 'Grabit API',
		description: `Complete Grabit HTTP API (~108 routes).

**Setup:** Import \`Grabit.local.postman_environment.json\`, select it, ensure API is running with \`SHOW_OTP_IN_RESPONSE=true\`.

**Auth:** Run \`00 Auth and Health\` verify-otp requests per role (OTP auto-saved from send-otp when shown).

**Flows:** Run \`06 Flows E2E\` folders in order after tokens + vendorId/listingId are set.

**Socket.IO** is not HTTP — use \`GET /orders/:id/tracking\` for REST tracking.

**Idempotency-Key required** on: POST /orders, POST /lists/:id/checkout, POST /services/bookings.`,
		schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
	},
	auth: authBearer('customerToken'),
	variable: [
		{ key: 'baseUrl', value: 'http://localhost:3001/api' },
	],
	item: [
		folder('00 Auth and Health', authHealth, 'OTP login for all seed roles + health'),
		folder('01 Public Catalog Geo Search', publicCatalog),
		folder('02 Customer', customer),
		folder('03 Vendor', vendor),
		folder('04 Delivery', delivery),
		folder('05 Admin Ops', admin),
		folder('06 Flows E2E', [
			folder('Flow A — COD self delivery', flowA),
			folder('Flow B — Partner rider', flowB),
			folder('Flow C — Service booking', flowC),
			folder('Flow D — List checkout', flowD),
			folder('Flow E — Razorpay create', flowE),
		]),
		folder('07 Negatives and Edges', negatives, 'Expected failures — check Tests tab'),
	],
};

function envValue(key, value, type = 'default') {
	return {
		key,
		value: String(value),
		type,
		enabled: true,
	};
}

const environment = {
	id: uid(),
	name: 'Grabit Local',
	values: [
		envValue('baseUrl', 'http://localhost:3001/api'),
		envValue('lat', '19.076'),
		envValue('lng', '72.8777'),
		envValue('customerPhone', '9111111111'),
		envValue('vendorPhone', '9000000001'),
		envValue('vendor2Phone', '9000000002'),
		envValue('deliveryPhone', '9000000088'),
		envValue('adminPhone', '9000000099'),
		envValue('regionalPhone', '9000000077'),
		envValue('fieldPhone', '9000000066'),
		envValue('customerToken', '', 'secret'),
		envValue('vendorToken', '', 'secret'),
		envValue('deliveryToken', '', 'secret'),
		envValue('adminToken', '', 'secret'),
		envValue('regionalToken', '', 'secret'),
		envValue('fieldToken', '', 'secret'),
		envValue('refreshToken', '', 'secret'),
		envValue('customerOtp', ''),
		envValue('vendorOtp', ''),
		envValue('deliveryOtpLogin', ''),
		envValue('adminOtp', ''),
		envValue('regionalOtp', ''),
		envValue('fieldOtp', ''),
		envValue('orderId', ''),
		envValue('jobId', ''),
		envValue('vendorId', ''),
		envValue('listingId', ''),
		envValue('masterProductId', ''),
		envValue('addressId', ''),
		envValue('bookingId', ''),
		envValue('disputeId', ''),
		envValue('listId', ''),
		envValue('listItemId', ''),
		envValue('vendorServiceId', ''),
		envValue('proposalId', ''),
		envValue('verificationId', ''),
		envValue('placeId', ''),
		envValue('imageUrl', ''),
		envValue('previewToken', ''),
		envValue('paymentId', ''),
		envValue('razorpayOrderId', ''),
		envValue('deliveryOtp', ''),
		envValue('idempotencyKey', ''),
		envValue('fieldUserId', ''),
		envValue('targetUserId', ''),
		envValue('memberUserId', ''),
		envValue('ledgerAccountRef', 'vendor:1'),
		envValue('customerUserId', ''),
		envValue('vendorUserId', ''),
	],
	_postman_variable_scope: 'environment',
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
	path.join(outDir, 'Grabit.postman_collection.json'),
	JSON.stringify(collection, null, 2)
);
fs.writeFileSync(
	path.join(outDir, 'Grabit.local.postman_environment.json'),
	JSON.stringify(environment, null, 2)
);

function countRequests(items) {
	let n = 0;
	for (const it of items) {
		if (it.item) n += countRequests(it.item);
		else if (it.request) n += 1;
	}
	return n;
}

console.log('Wrote', path.join(outDir, 'Grabit.postman_collection.json'));
console.log('Wrote', path.join(outDir, 'Grabit.local.postman_environment.json'));
console.log('Request count:', countRequests(collection.item));
