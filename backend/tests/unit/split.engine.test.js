import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	fingerprintStrategy,
	splitListAcrossVendors,
	STRATEGY_VERSION,
} from '../../src/domains/lists/split.engine.js';

describe('splitListAcrossVendors', () => {
	it('returns empty buckets for empty list', () => {
		const result = splitListAcrossVendors([], {});
		assert.equal(result.vendor_buckets.length, 0);
		assert.equal(result.pricing.total_paise, 0);
		assert.equal(result.strategy_version, STRATEGY_VERSION);
	});

	it('assigns all items to a single covering vendor', () => {
		const listItems = [
			{ item_id: 1, master_product_id: 10, qty: 2 },
			{ item_id: 2, master_product_id: 11, qty: 1 },
		];
		const candidates = {
			10: [{ vendor_id: 1, listing_id: 100, price_paise: 3300, available_qty: 10, distance_m: 100 }],
			11: [{ vendor_id: 1, listing_id: 101, price_paise: 4500, available_qty: 5, distance_m: 100 }],
		};
		const result = splitListAcrossVendors(listItems, candidates, { deliveryFeePaise: 2000 });
		assert.equal(result.vendor_buckets.length, 1);
		assert.equal(result.vendor_buckets[0].vendor_id, 1);
		assert.equal(result.unfulfillable.length, 0);
		assert.equal(result.pricing.subtotal_paise, 3300 * 2 + 4500);
		assert.equal(result.pricing.delivery_fee_paise, 2000);
		assert.equal(result.pricing.vendor_count, 1);
	});

	it('splits across two vendors when needed', () => {
		const listItems = [
			{ item_id: 1, master_product_id: 10, qty: 1 },
			{ item_id: 2, master_product_id: 20, qty: 1 },
		];
		const candidates = {
			10: [{ vendor_id: 1, listing_id: 1, price_paise: 1000, available_qty: 5, distance_m: 50 }],
			20: [{ vendor_id: 2, listing_id: 2, price_paise: 2000, available_qty: 5, distance_m: 80 }],
		};
		const result = splitListAcrossVendors(listItems, candidates, { deliveryFeePaise: 2000 });
		assert.equal(result.vendor_buckets.length, 2);
		assert.equal(result.unfulfillable.length, 0);
		assert.equal(result.pricing.delivery_fee_paise, 4000);
		assert.equal(result.pricing.subtotal_paise, 3000);
	});

	it('marks items with no candidates as unfulfillable', () => {
		const listItems = [{ item_id: 1, master_product_id: 99, qty: 1 }];
		const result = splitListAcrossVendors(listItems, {});
		assert.equal(result.vendor_buckets.length, 0);
		assert.equal(result.unfulfillable.length, 1);
		assert.equal(result.unfulfillable[0].reason, 'NO_VENDOR');
	});

	it('ignores zero-stock listings', () => {
		const listItems = [{ item_id: 1, master_product_id: 10, qty: 2 }];
		const candidates = {
			10: [
				{ vendor_id: 1, listing_id: 1, price_paise: 100, available_qty: 1, distance_m: 10 },
				{ vendor_id: 2, listing_id: 2, price_paise: 200, available_qty: 5, distance_m: 20 },
			],
		};
		const result = splitListAcrossVendors(listItems, candidates);
		assert.equal(result.vendor_buckets.length, 1);
		assert.equal(result.vendor_buckets[0].vendor_id, 2);
		assert.equal(result.vendor_buckets[0].items[0].listing_id, 2);
	});

	it('respects maxVendors cap and leaves leftovers unfulfillable', () => {
		const listItems = [
			{ item_id: 1, master_product_id: 1, qty: 1 },
			{ item_id: 2, master_product_id: 2, qty: 1 },
			{ item_id: 3, master_product_id: 3, qty: 1 },
		];
		const candidates = {
			1: [{ vendor_id: 1, listing_id: 1, price_paise: 100, available_qty: 9, distance_m: 10 }],
			2: [{ vendor_id: 2, listing_id: 2, price_paise: 100, available_qty: 9, distance_m: 10 }],
			3: [{ vendor_id: 3, listing_id: 3, price_paise: 100, available_qty: 9, distance_m: 10 }],
		};
		const result = splitListAcrossVendors(listItems, candidates, { maxVendors: 2 });
		assert.equal(result.vendor_buckets.length, 2);
		assert.equal(result.unfulfillable.length, 1);
		assert.equal(result.unfulfillable[0].reason, 'VENDOR_CAP');
	});

	it('picks cheapest listing for a vendor when multiple exist', () => {
		const listItems = [{ item_id: 1, master_product_id: 10, qty: 1 }];
		const candidates = {
			10: [
				{ vendor_id: 1, listing_id: 2, price_paise: 500, available_qty: 9, distance_m: 10 },
				{ vendor_id: 1, listing_id: 1, price_paise: 300, available_qty: 9, distance_m: 10 },
			],
		};
		const result = splitListAcrossVendors(listItems, candidates);
		assert.equal(result.vendor_buckets[0].items[0].listing_id, 1);
		assert.equal(result.vendor_buckets[0].items[0].unit_price_paise, 300);
	});

	it('is deterministic on price ties (lower vendor_id / listing_id)', () => {
		const listItems = [{ item_id: 1, master_product_id: 10, qty: 1 }];
		const candidates = {
			10: [
				{ vendor_id: 5, listing_id: 50, price_paise: 100, available_qty: 9, distance_m: 10 },
				{ vendor_id: 3, listing_id: 30, price_paise: 100, available_qty: 9, distance_m: 10 },
			],
		};
		const a = splitListAcrossVendors(listItems, candidates);
		const b = splitListAcrossVendors(listItems, candidates);
		assert.deepEqual(a, b);
		assert.equal(a.vendor_buckets[0].vendor_id, 3);
	});

	it('prefers consolidating onto one vendor when it covers all', () => {
		const listItems = [
			{ item_id: 1, master_product_id: 10, qty: 1 },
			{ item_id: 2, master_product_id: 11, qty: 1 },
		];
		const candidates = {
			10: [
				{ vendor_id: 1, listing_id: 1, price_paise: 1100, available_qty: 9, distance_m: 10 },
				{ vendor_id: 2, listing_id: 2, price_paise: 1000, available_qty: 9, distance_m: 10 },
			],
			11: [
				{ vendor_id: 1, listing_id: 3, price_paise: 1100, available_qty: 9, distance_m: 10 },
				{ vendor_id: 3, listing_id: 4, price_paise: 1000, available_qty: 9, distance_m: 10 },
			],
		};
		const result = splitListAcrossVendors(listItems, candidates, {
			deliveryFeePaise: 2000,
			consolidationSlackPaise: 5000,
		});
		assert.equal(result.vendor_buckets.length, 1);
		assert.equal(result.vendor_buckets[0].vendor_id, 1);
	});

	it('fingerprint is stable regardless of bucket insertion order', () => {
		const listItems = [
			{ item_id: 1, master_product_id: 10, qty: 1 },
			{ item_id: 2, master_product_id: 20, qty: 1 },
		];
		const candidates = {
			10: [{ vendor_id: 2, listing_id: 2, price_paise: 100, available_qty: 5, distance_m: 1 }],
			20: [{ vendor_id: 1, listing_id: 1, price_paise: 100, available_qty: 5, distance_m: 1 }],
		};
		const result = splitListAcrossVendors(listItems, candidates);
		const fp1 = fingerprintStrategy(result);
		const fp2 = fingerprintStrategy(result);
		assert.equal(fp1, fp2);
	});
});
