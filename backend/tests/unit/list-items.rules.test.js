import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListError } from '../../src/domains/lists/list.errors.js';
import { validateQty } from '../../src/domains/lists/list-items.service.js';
import {
	assertCanCheckout,
	assertCanEditItems,
	assertCanManageMembers,
	assertCanRead,
} from '../../src/domains/lists/lists.service.js';

describe('list item rules', () => {
	it('accepts qty >= 1', () => {
		assert.equal(validateQty(1), 1);
		assert.equal(validateQty(5), 5);
	});

	it('rejects invalid qty', () => {
		assert.throws(() => validateQty(0), ListError);
		assert.throws(() => validateQty(-1), ListError);
		assert.throws(() => validateQty(1.5), ListError);
		assert.throws(() => validateQty('x'), ListError);
	});
});

describe('list authz matrix', () => {
	it('viewer can read but not edit or checkout or manage', () => {
		assert.doesNotThrow(() => assertCanRead('viewer'));
		assert.throws(() => assertCanEditItems('viewer'), ListError);
		assert.throws(() => assertCanCheckout('viewer'), ListError);
		assert.throws(() => assertCanManageMembers('viewer'), ListError);
	});

	it('editor can edit and checkout but not manage members', () => {
		assert.doesNotThrow(() => assertCanEditItems('editor'));
		assert.doesNotThrow(() => assertCanCheckout('editor'));
		assert.throws(() => assertCanManageMembers('editor'), ListError);
	});

	it('owner can do everything', () => {
		assert.doesNotThrow(() => assertCanRead('owner'));
		assert.doesNotThrow(() => assertCanEditItems('owner'));
		assert.doesNotThrow(() => assertCanCheckout('owner'));
		assert.doesNotThrow(() => assertCanManageMembers('owner'));
	});
});
