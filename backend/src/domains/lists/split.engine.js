/**
 * Pure multi-vendor split engine — no DB I/O.
 *
 * Input shape:
 *   listItems: [{ item_id, master_product_id, qty }]
 *   candidatesByMaster: Map|Object master_product_id -> [{
 *     vendor_id, listing_id, price_paise, available_qty, distance_m
 *   }]
 *   options: { deliveryFeePaise, maxVendors, consolidationSlackPaise, strategyVersion }
 */

export const STRATEGY_VERSION = 'split.v1';

export function normalizeCandidates(candidatesByMaster) {
	if (candidatesByMaster instanceof Map) {
		const obj = {};
		for (const [k, v] of candidatesByMaster.entries()) obj[String(k)] = v;
		return obj;
	}
	return candidatesByMaster || {};
}

/**
 * @returns {{
 *   vendor_buckets: Array<{ vendor_id, items: Array, subtotal_paise, delivery_fee_paise, total_paise }>,
 *   unfulfillable: Array,
 *   pricing: { subtotal_paise, delivery_fee_paise, total_paise, vendor_count },
 *   strategy_version: string
 * }}
 */
export function splitListAcrossVendors(listItems, candidatesByMaster, options = {}) {
	const deliveryFeePaise = Number(options.deliveryFeePaise ?? 2000);
	const maxVendors = Number(options.maxVendors ?? 5);
	const consolidationSlackPaise = Number(options.consolidationSlackPaise ?? 500);
	const strategyVersion = options.strategyVersion || STRATEGY_VERSION;

	const candidates = normalizeCandidates(candidatesByMaster);
	const remaining = new Map();
	const unfulfillable = [];

	for (const item of listItems || []) {
		const masterId = String(item.master_product_id);
		const qty = Number(item.qty);
		const pool = (candidates[masterId] || [])
			.filter((c) => Number(c.available_qty) >= qty && Number(c.price_paise) >= 0)
			.map((c) => ({
				vendor_id: Number(c.vendor_id),
				listing_id: Number(c.listing_id),
				price_paise: Number(c.price_paise),
				available_qty: Number(c.available_qty),
				distance_m: Number(c.distance_m ?? 0),
			}))
			.sort((a, b) => {
				if (a.price_paise !== b.price_paise) return a.price_paise - b.price_paise;
				if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m;
				return a.listing_id - b.listing_id;
			});

		if (!pool.length) {
			unfulfillable.push({
				item_id: item.item_id,
				master_product_id: Number(item.master_product_id),
				qty,
				reason: 'NO_VENDOR',
			});
			continue;
		}

		remaining.set(masterId, {
			item_id: item.item_id,
			master_product_id: Number(item.master_product_id),
			qty,
			candidates: pool,
		});
	}

	const assignments = new Map(); // vendor_id -> items[]
	const assignedMasters = new Set();

	while (remaining.size > 0 && assignments.size < maxVendors) {
		const vendorScore = scoreVendors(remaining, deliveryFeePaise, consolidationSlackPaise, assignments.size);
		if (!vendorScore.length) break;

		const best = vendorScore[0];
		const vendorId = best.vendor_id;
		const bucketItems = [];

		for (const [masterId, entry] of remaining.entries()) {
			const offer = entry.candidates.find((c) => c.vendor_id === vendorId);
			if (!offer) continue;
			bucketItems.push({
				item_id: entry.item_id,
				master_product_id: entry.master_product_id,
				listing_id: offer.listing_id,
				qty: entry.qty,
				unit_price_paise: offer.price_paise,
				line_total_paise: offer.price_paise * entry.qty,
			});
			assignedMasters.add(masterId);
		}

		if (!bucketItems.length) break;

		assignments.set(vendorId, bucketItems);
		for (const masterId of assignedMasters) remaining.delete(masterId);
		assignedMasters.clear();
	}

	for (const entry of remaining.values()) {
		unfulfillable.push({
			item_id: entry.item_id,
			master_product_id: entry.master_product_id,
			qty: entry.qty,
			reason: assignments.size >= maxVendors ? 'VENDOR_CAP' : 'UNASSIGNED',
		});
	}

	const vendor_buckets = [];
	let subtotal = 0;
	for (const [vendor_id, items] of [...assignments.entries()].sort((a, b) => a[0] - b[0])) {
		const bucketSub = items.reduce((s, i) => s + i.line_total_paise, 0);
		subtotal += bucketSub;
		vendor_buckets.push({
			vendor_id,
			items,
			subtotal_paise: bucketSub,
			delivery_fee_paise: deliveryFeePaise,
			total_paise: bucketSub + deliveryFeePaise,
		});
	}

	const vendor_count = vendor_buckets.length;
	const delivery_total = deliveryFeePaise * vendor_count;

	return {
		vendor_buckets,
		unfulfillable,
		pricing: {
			subtotal_paise: subtotal,
			delivery_fee_paise: delivery_total,
			total_paise: subtotal + delivery_total,
			vendor_count,
		},
		strategy_version: strategyVersion,
	};
}

function scoreVendors(remaining, deliveryFeePaise, consolidationSlackPaise, alreadyPickedCount) {
	const byVendor = new Map();

	for (const entry of remaining.values()) {
		for (const c of entry.candidates) {
			if (!byVendor.has(c.vendor_id)) {
				byVendor.set(c.vendor_id, {
					vendor_id: c.vendor_id,
					items: [],
					priceSum: 0,
					distanceSum: 0,
				});
			}
			const v = byVendor.get(c.vendor_id);
			// cheapest listing for this vendor already first in candidates filter per vendor
			if (v.items.some((i) => i.master_product_id === entry.master_product_id)) continue;
			const offer = entry.candidates
				.filter((x) => x.vendor_id === c.vendor_id)
				.sort((a, b) => a.price_paise - b.price_paise || a.listing_id - b.listing_id)[0];
			v.items.push({
				master_product_id: entry.master_product_id,
				price_paise: offer.price_paise,
				distance_m: offer.distance_m,
			});
			v.priceSum += offer.price_paise * entry.qty;
			v.distanceSum += offer.distance_m;
		}
	}

	const scored = [];
	for (const v of byVendor.values()) {
		if (!v.items.length) continue;
		const coverCount = v.items.length;
		const avgPrice = v.priceSum / coverCount;
		const avgDistance = v.distanceSum / coverCount;
		const distancePenalty = avgDistance / 1000; // km-ish
		const feePenalty = alreadyPickedCount > 0 ? 0 : 0;
		// Higher cover + lower price wins. Slack encourages consolidation by boosting cover weight.
		const score =
			coverCount * (1 + consolidationSlackPaise / 10000) / (avgPrice / 100 + distancePenalty + 0.01) -
			feePenalty;
		scored.push({
			vendor_id: v.vendor_id,
			score,
			coverCount,
			priceSum: v.priceSum,
			avgPrice,
		});
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (b.coverCount !== a.coverCount) return b.coverCount - a.coverCount;
		if (a.priceSum !== b.priceSum) return a.priceSum - b.priceSum;
		return a.vendor_id - b.vendor_id;
	});

	return scored;
}

/** Stable fingerprint of strategy for preview tokens (order-independent). */
export function fingerprintStrategy(result) {
	const buckets = (result.vendor_buckets || []).map((b) => ({
		vendor_id: b.vendor_id,
		items: b.items
			.map((i) => ({
				master_product_id: i.master_product_id,
				listing_id: i.listing_id,
				qty: i.qty,
				unit_price_paise: i.unit_price_paise,
			}))
			.sort((a, b) => a.master_product_id - b.master_product_id),
	}));
	buckets.sort((a, b) => a.vendor_id - b.vendor_id);
	const unfulfillable = (result.unfulfillable || [])
		.map((u) => ({ master_product_id: u.master_product_id, qty: u.qty, reason: u.reason }))
		.sort((a, b) => a.master_product_id - b.master_product_id);
	return JSON.stringify({
		strategy_version: result.strategy_version,
		buckets,
		unfulfillable,
		pricing: result.pricing,
	});
}
