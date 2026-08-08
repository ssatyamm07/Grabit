import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFulfillmentMode } from '../../src/domains/orders/fulfillment.js';
import { canTransition } from '../../src/domains/orders/order.state.js';

describe('resolveFulfillmentMode', () => {
	it('defaults either to self', () => {
		assert.equal(resolveFulfillmentMode(null, 'either'), 'self');
	});

	it('respects explicit self/partner', () => {
		assert.equal(resolveFulfillmentMode('partner', 'either'), 'partner');
		assert.equal(resolveFulfillmentMode('self', 'either'), 'self');
	});

	it('rejects mismatch with vendor default', () => {
		assert.throws(() => resolveFulfillmentMode('partner', 'self'), /only supports self/);
		assert.throws(() => resolveFulfillmentMode('self', 'partner'), /only supports partner/);
	});
});

describe('fulfillment transition matrix', () => {
	it('allows ready → picked → delivered', () => {
		assert.equal(canTransition('ready', 'picked'), true);
		assert.equal(canTransition('picked', 'delivered'), true);
		assert.equal(canTransition('ready', 'delivered'), false);
	});
});
