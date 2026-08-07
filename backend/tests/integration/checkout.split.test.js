import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import * as lists from '../../src/domains/lists/lists.service.js';
import * as items from '../../src/domains/lists/list-items.service.js';
import * as checkout from '../../src/domains/lists/checkout.service.js';
import { placeOrderForVendor } from '../../src/domains/orders/place-order.service.js';
import { ListError } from '../../src/domains/lists/list.errors.js';

describe('checkout split integration', () => {
	let fx;

	before(async () => {
		await resetDb();
	});

	beforeEach(async () => {
		await resetDb();
		fx = await seedSplitFixture();
	});

	after(async () => {
		// keep pool open for other test files in the same process
	});

	async function buildSplitList() {
		const list = await lists.createList({
			ownerUserId: fx.customerId,
			name: 'Weekly grocery',
			listType: 'grocery',
		});
		await items.addItem(list.id, fx.customerId, { master_product_id: fx.saltId, qty: 1 });
		await items.addItem(list.id, fx.customerId, { master_product_id: fx.incenseId, qty: 1 });
		return list;
	}

	it('preview returns multi-vendor buckets and confirm places N orders atomically', async () => {
		const list = await buildSplitList();
		const preview = await checkout.previewCheckout(list.id, fx.customerId, {
			lat: fx.lat,
			lng: fx.lng,
		});

		assert.equal(preview.can_confirm, true);
		assert.ok(preview.preview_token);
		assert.ok(preview.vendor_buckets.length >= 2);
		assert.equal(preview.unfulfillable.length, 0);
		assert.equal(
			preview.pricing.delivery_fee_paise,
			2000 * preview.pricing.vendor_count
		);

		const result = await checkout.confirmCheckout(
			list.id,
			fx.customerId,
			{ preview_token: preview.preview_token, payment_method: 'cod' },
			'idem_split_001'
		);

		assert.equal(result.replayed, false);
		assert.equal(result.orders.length, preview.pricing.vendor_count);
		assert.equal(result.order_group.status, 'placed');

		const reserved = await pool.query(
			`SELECT SUM(reserved_qty)::int AS r FROM vendor_inventory`
		);
		assert.ok(Number(reserved.rows[0].r) >= 2);
	});

	it('idempotent confirm replay returns same order group', async () => {
		const list = await buildSplitList();
		const preview = await checkout.previewCheckout(list.id, fx.customerId, {
			lat: fx.lat,
			lng: fx.lng,
		});
		const first = await checkout.confirmCheckout(
			list.id,
			fx.customerId,
			{ preview_token: preview.preview_token },
			'idem_split_002'
		);
		const second = await checkout.confirmCheckout(
			list.id,
			fx.customerId,
			{ preview_token: preview.preview_token },
			'idem_split_002'
		);
		assert.equal(second.replayed, true);
		assert.equal(first.order_group.id, second.order_group.id);
	});

	it('stale preview when stock changes after preview', async () => {
		const list = await buildSplitList();
		const preview = await checkout.previewCheckout(list.id, fx.customerId, {
			lat: fx.lat,
			lng: fx.lng,
		});

		// Zero out incense stock (vendor 2 exclusive)
		await pool.query(
			`UPDATE vendor_inventory vi
			 SET qty = 0, reserved_qty = 0
			 FROM vendor_listings vl
			 WHERE vl.id = vi.vendor_listing_id
			   AND vl.master_product_id = $1`,
			[fx.incenseId]
		);

		await assert.rejects(
			() =>
				checkout.confirmCheckout(
					list.id,
					fx.customerId,
					{ preview_token: preview.preview_token },
					'idem_split_stale'
				),
			(err) => err instanceof ListError && err.code === 'PREVIEW_STALE'
		);

		const orders = await pool.query(`SELECT count(*)::int AS c FROM orders`);
		assert.equal(orders.rows[0].c, 0);
	});

	it('single-vendor placeOrderForVendor still works (regression)', async () => {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const listing = await client.query(
				`SELECT id FROM vendor_listings WHERE vendor_id = $1 AND master_product_id = $2`,
				[fx.vendor1Id, fx.saltId]
			);
			const { order } = await placeOrderForVendor(client, {
				customerId: fx.customerId,
				vendorId: fx.vendor1Id,
				items: [{ listing_id: listing.rows[0].id, qty: 1 }],
				paymentMethod: 'cod',
			});
			await client.query('COMMIT');
			assert.equal(order.status, 'placed');
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	});
});
