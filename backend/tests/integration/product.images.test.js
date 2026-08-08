import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { request } from '../helpers/supertest-lite.js';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import { createApp } from '../../src/app.js';

dotenv.config();

// 1x1 PNG
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function token(user) {
	return jwt.sign(
		{ id: user.id, role: user.role, city_id: user.city_id, phone: user.phone },
		process.env.JWT_SECRET || 'test-secret',
		{ expiresIn: '1h' }
	);
}

describe('product image upload (MinIO/S3-compatible, memory driver in tests)', () => {
	let app;
	let admin;
	let productId;
	let at;

	before(async () => {
		process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
		process.env.STORAGE_DRIVER = 'memory';
		process.env.S3_PUBLIC_URL = 'http://memory.local';
		process.env.MINIO_BUCKET_PRODUCTS = 'products';

		// Re-import storage after env — module already loaded; force memory via env before import in handlers
		const storage = (await import('../../src/services/storage.js')).default;
		storage.driver = 'memory';
		storage.memory = new Map();
		storage.bucket = 'products';
		storage.baseUrl = 'http://memory.local';
		storage.ready = true;

		app = createApp();
		await resetDb();
		const fx = await seedSplitFixture();
		const cityId = (await pool.query(`SELECT city_id FROM users WHERE id = $1`, [fx.customerId]))
			.rows[0].city_id;
		admin = (
			await pool.query(
				`INSERT INTO users (name, phone, role, phone_verified, city_id)
				 VALUES ('Admin', '9000000099', 'super_admin', TRUE, $1) RETURNING *`,
				[cityId]
			)
		).rows[0];
		at = token(admin);

		const created = await request(app)
			.post('/api/admin/catalog/master')
			.set('Authorization', `Bearer ${at}`)
			.send({
				name: 'Image Test SKU',
				brand: 'Grabit',
				category: 'Grocery',
				barcode: '8800000000001',
			});
		assert.equal(created.status, 201);
		productId = created.body.product.id;
	});

	after(async () => {});

	it('uploads base64 image and attaches URL to master_products.images', async () => {
		const res = await request(app)
			.post(`/api/admin/catalog/master/${productId}/images`)
			.set('Authorization', `Bearer ${at}`)
			.send({
				images: [`data:image/png;base64,${TINY_PNG_BASE64}`],
			});
		assert.equal(res.status, 201, JSON.stringify(res.body));
		assert.ok(res.body.uploaded?.length >= 1);
		assert.ok(res.body.product.images.length >= 1);
		assert.match(res.body.product.images[0], /^http:\/\/memory\.local\/products\//);
	});

	it('rejects non-staff upload', async () => {
		const customer = (await pool.query(`SELECT * FROM users WHERE phone = '9111111111'`)).rows[0];
		const res = await request(app)
			.post(`/api/admin/catalog/master/${productId}/images`)
			.set('Authorization', `Bearer ${token(customer)}`)
			.send({ images: [`data:image/png;base64,${TINY_PNG_BASE64}`] });
		assert.equal(res.status, 403);
	});

	it('deletes image by url', async () => {
		const product = await pool.query(`SELECT images FROM master_products WHERE id = $1`, [
			productId,
		]);
		const url = product.rows[0].images[0];
		assert.ok(url);

		const res = await request(app)
			.delete(`/api/admin/catalog/master/${productId}/images`)
			.set('Authorization', `Bearer ${at}`)
			.send({ url });
		assert.equal(res.status, 200);
		assert.ok(!res.body.product.images.includes(url));
	});

	it('catalog get returns images field', async () => {
		await request(app)
			.post(`/api/admin/catalog/master/${productId}/images`)
			.set('Authorization', `Bearer ${at}`)
			.send({ images: [`data:image/png;base64,${TINY_PNG_BASE64}`] });

		const res = await request(app).get(`/api/catalog/master/${productId}`);
		assert.equal(res.status, 200);
		assert.ok(Array.isArray(res.body.product.images));
		assert.ok(res.body.product.images.length >= 1);
	});
});
