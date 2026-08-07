import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, seedSplitFixture, pool } from '../helpers/db.js';
import * as lists from '../../src/domains/lists/lists.service.js';
import * as items from '../../src/domains/lists/list-items.service.js';
import { ListError } from '../../src/domains/lists/list.errors.js';

describe('lists integration', () => {
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

	it('creates list types and upserts items by master product', async () => {
		const list = await lists.createList({
			ownerUserId: fx.customerId,
			name: 'Weekly grocery',
			listType: 'grocery',
		});
		assert.equal(list.list_type, 'grocery');

		const a = await items.addItem(list.id, fx.customerId, {
			master_product_id: fx.milkId,
			qty: 1,
		});
		const b = await items.addItem(list.id, fx.customerId, {
			master_product_id: fx.milkId,
			qty: 2,
		});
		assert.equal(a.id, b.id);
		assert.equal(b.qty, 3);

		const detail = await lists.getListDetail(list.id, fx.customerId);
		assert.equal(detail.items.length, 1);
		assert.equal(detail.role, 'owner');
	});

	it('adds member by phone and enforces authz', async () => {
		const list = await lists.createList({
			ownerUserId: fx.customerId,
			name: 'Pooja',
			listType: 'pooja',
		});

		const { user } = await lists.addMemberByPhone(list.id, fx.customerId, '9222222222', 'viewer');
		assert.ok(user.id);

		await assert.rejects(
			() => items.addItem(list.id, user.id, { master_product_id: fx.incenseId, qty: 1 }),
			(err) => err instanceof ListError && err.code === 'FORBIDDEN'
		);

		await lists.addMemberByPhone(list.id, fx.customerId, '9222222222', 'editor');
		const item = await items.addItem(list.id, user.id, { master_product_id: fx.incenseId, qty: 1 });
		assert.equal(item.qty, 1);

		await assert.rejects(
			() => lists.removeMember(list.id, user.id, fx.customerId),
			(err) => err instanceof ListError && err.code === 'FORBIDDEN'
		);
	});

	it('cannot remove owner', async () => {
		const list = await lists.createList({
			ownerUserId: fx.customerId,
			name: 'Dairy',
			listType: 'dairy',
		});
		await assert.rejects(
			() => lists.removeMember(list.id, fx.customerId, fx.customerId),
			(err) => err instanceof ListError
		);
	});

	it('optimistic version conflict on item update', async () => {
		const list = await lists.createList({
			ownerUserId: fx.customerId,
			name: 'Veg',
			listType: 'vegetables',
		});
		const item = await items.addItem(list.id, fx.customerId, {
			master_product_id: fx.saltId,
			qty: 1,
		});
		await items.updateItem(list.id, fx.customerId, item.id, { qty: 2, version: item.version });
		await assert.rejects(
			() =>
				items.updateItem(list.id, fx.customerId, item.id, {
					qty: 9,
					version: item.version,
				}),
			(err) => err instanceof ListError && err.code === 'VERSION_CONFLICT'
		);
	});
});
