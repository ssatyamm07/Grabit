import crypto from 'crypto';
import pool from '../../db.js';
import { deliveryFeePaise, placeOrderForVendor, loadOrder } from '../orders/place-order.service.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { ListError } from './list.errors.js';
import { loadListItems } from './list-items.service.js';
import { assertCanCheckout, getMembership } from './lists.service.js';
import { fingerprintStrategy, splitListAcrossVendors, STRATEGY_VERSION } from './split.engine.js';

const PREVIEW_TTL_MS = Number(process.env.CHECKOUT_PREVIEW_TTL_MS || 5 * 60_000);
const MAX_SPLIT_VENDORS = Number(process.env.MAX_SPLIT_VENDORS || 5);
const VENDOR_CONSOLIDATION_SLACK_PAISE = Number(process.env.VENDOR_CONSOLIDATION_SLACK_PAISE || 500);

function hashToken(token) {
	return crypto.createHash('sha256').update(token).digest('hex');
}

function makePreviewToken() {
	return `pv_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Load candidate listings near lat/lng for the given master product ids.
 */
export async function loadCandidatesForMasters(client, masterIds, lat, lng) {
	if (!masterIds.length) return {};

	const result = await client.query(
		`SELECT
			vl.id AS listing_id,
			vl.vendor_id,
			vl.master_product_id,
			vl.price_paise,
			COALESCE(vi.qty, 0) - COALESCE(vi.reserved_qty, 0) AS available_qty,
			ST_Distance(
				v.location,
				ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
			) AS distance_m
		 FROM vendor_listings vl
		 JOIN vendors v ON v.id = vl.vendor_id
		 LEFT JOIN vendor_inventory vi ON vi.vendor_listing_id = vl.id
		 WHERE vl.master_product_id = ANY($3::int[])
		   AND vl.is_active = TRUE
		   AND v.is_approved = TRUE
		   AND v.is_open = TRUE
		   AND v.location IS NOT NULL
		   AND ST_DWithin(
		     v.location,
		     ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
		     v.coverage_radius_m
		   )
		 ORDER BY vl.master_product_id, vl.price_paise ASC, distance_m ASC, vl.id ASC`,
		[lat, lng, masterIds]
	);

	const byMaster = {};
	for (const row of result.rows) {
		const key = String(row.master_product_id);
		if (!byMaster[key]) byMaster[key] = [];
		byMaster[key].push({
			vendor_id: Number(row.vendor_id),
			listing_id: Number(row.listing_id),
			price_paise: Number(row.price_paise),
			available_qty: Number(row.available_qty),
			distance_m: Number(row.distance_m),
		});
	}
	return byMaster;
}

async function resolveLatLng(userId, body, client = pool) {
	if (body.lat != null && body.lng != null) {
		const lat = Number(body.lat);
		const lng = Number(body.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			throw new ListError('VALIDATION', 'lat and lng must be numbers');
		}
		return { lat, lng, deliveryAddress: body.delivery_address || { lat, lng } };
	}

	const addressId = Number(body.address_id);
	if (!Number.isInteger(addressId) || addressId < 1) {
		throw new ListError('VALIDATION', 'lat/lng or address_id required');
	}

	const addr = await client.query(
		`SELECT *, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
		 FROM addresses WHERE id = $1 AND user_id = $2`,
		[addressId, userId]
	);
	if (addr.rowCount === 0) {
		throw new ListError('ADDRESS_NOT_FOUND', 'Address not found', 404);
	}
	const row = addr.rows[0];
	if (row.lat == null || row.lng == null) {
		throw new ListError('VALIDATION', 'Address has no coordinates');
	}
	return {
		lat: Number(row.lat),
		lng: Number(row.lng),
		deliveryAddress: {
			address_id: row.id,
			label: row.label,
			street: row.street,
			house_details: row.house_details,
			landmark: row.landmark,
			area: row.area,
			pincode: row.pincode,
			lat: Number(row.lat),
			lng: Number(row.lng),
		},
	};
}

export async function buildSplitForList(client, listId, lat, lng) {
	const items = await loadListItems(listId, client);
	if (!items.length) {
		throw new ListError('VALIDATION', 'List is empty');
	}

	const masterIds = items.map((i) => Number(i.master_product_id));
	const candidates = await loadCandidatesForMasters(client, masterIds, lat, lng);

	const listItems = items.map((i) => ({
		item_id: i.item_id,
		master_product_id: i.master_product_id,
		qty: i.qty,
	}));

	const split = splitListAcrossVendors(listItems, candidates, {
		deliveryFeePaise: deliveryFeePaise(),
		maxVendors: MAX_SPLIT_VENDORS,
		consolidationSlackPaise: VENDOR_CONSOLIDATION_SLACK_PAISE,
		strategyVersion: STRATEGY_VERSION,
	});

	return { items, split, fingerprint: fingerprintStrategy(split) };
}

export async function previewCheckout(listId, userId, body) {
	const { role } = await getMembership(listId, userId);
	assertCanCheckout(role);

	const client = await pool.connect();
	try {
		const { lat, lng, deliveryAddress } = await resolveLatLng(userId, body, client);
		const { split, fingerprint } = await buildSplitForList(client, listId, lat, lng);

		const token = makePreviewToken();
		const tokenHash = hashToken(token);
		const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);

		const snapshot = {
			...split,
			fingerprint,
			lat,
			lng,
			delivery_address: deliveryAddress,
			list_id: listId,
		};

		await client.query(
			`INSERT INTO checkout_previews (token_hash, user_id, list_id, strategy_snapshot, expires_at)
			 VALUES ($1, $2, $3, $4::jsonb, $5)`,
			[tokenHash, userId, listId, JSON.stringify(snapshot), expiresAt]
		);

		return {
			preview_token: token,
			expires_at: expiresAt.toISOString(),
			can_confirm: split.unfulfillable.length === 0 && split.vendor_buckets.length > 0,
			...split,
		};
	} finally {
		client.release();
	}
}

export async function confirmCheckout(listId, userId, { preview_token, payment_method, fulfillment_mode } = {}, idempotencyKey) {
	const { role } = await getMembership(listId, userId);
	assertCanCheckout(role);

	if (!preview_token) {
		throw new ListError('VALIDATION', 'preview_token required');
	}
	if (!idempotencyKey) {
		throw new ListError('VALIDATION', 'Idempotency-Key required');
	}

	const tokenHash = hashToken(preview_token);
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const existingGroup = await client.query(
			`SELECT * FROM order_groups WHERE customer_id = $1 AND idempotency_key = $2`,
			[userId, idempotencyKey]
		);
		if (existingGroup.rowCount > 0) {
			await client.query('COMMIT');
			const group = existingGroup.rows[0];
			const orders = await loadGroupOrders(group.id);
			return { order_group: group, orders, replayed: true };
		}

		const preview = await client.query(
			`SELECT * FROM checkout_previews
			 WHERE token_hash = $1 AND user_id = $2 AND list_id = $3
			 FOR UPDATE`,
			[tokenHash, userId, listId]
		);

		if (preview.rowCount === 0) {
			throw new ListError('PREVIEW_INVALID', 'Invalid preview token', 400);
		}
		const prev = preview.rows[0];
		if (new Date(prev.expires_at) < new Date()) {
			throw new ListError('PREVIEW_EXPIRED', 'Preview expired — run preview again', 409);
		}

		const snapshot = prev.strategy_snapshot;
		const lat = snapshot.lat;
		const lng = snapshot.lng;
		const deliveryAddress = snapshot.delivery_address;

		const { split, fingerprint } = await buildSplitForList(client, listId, lat, lng);

		if (fingerprint !== snapshot.fingerprint) {
			const err = new ListError(
				'PREVIEW_STALE',
				'Availability or prices changed — review new preview',
				409,
				{ preview: split }
			);
			throw err;
		}

		if (split.unfulfillable.length > 0 || split.vendor_buckets.length === 0) {
			throw new ListError('UNFULFILLABLE', 'List cannot be fully fulfilled', 409, {
				unfulfillable: split.unfulfillable,
			});
		}

		const groupIns = await client.query(
			`INSERT INTO order_groups (
				customer_id, list_id, idempotency_key, status, strategy_snapshot,
				preview_token_hash, subtotal_paise, delivery_fee_paise, total_paise, vendor_count
			 ) VALUES ($1,$2,$3,'placed',$4::jsonb,$5,$6,$7,$8,$9)
			 RETURNING *`,
			[
				userId,
				listId,
				idempotencyKey,
				JSON.stringify(split),
				tokenHash,
				split.pricing.subtotal_paise,
				split.pricing.delivery_fee_paise,
				split.pricing.total_paise,
				split.pricing.vendor_count,
			]
		);
		const group = groupIns.rows[0];

		const placedOrders = [];
		for (const bucket of split.vendor_buckets) {
			const { order } = await placeOrderForVendor(client, {
				customerId: userId,
				vendorId: bucket.vendor_id,
				items: bucket.items.map((i) => ({ listing_id: i.listing_id, qty: i.qty })),
				paymentMethod: payment_method || 'cod',
				deliveryAddress,
				idempotencyKey: null,
				orderGroupId: group.id,
				shoppingListId: listId,
				actorUserId: userId,
				deliveryFee: bucket.delivery_fee_paise,
				fulfillmentMode: fulfillment_mode || null,
			});

			await client.query(
				`INSERT INTO order_group_orders (order_group_id, order_id) VALUES ($1, $2)`,
				[group.id, order.id]
			);
			placedOrders.push(order);
		}

		await enqueueOutbox(client, {
			eventType: 'order_group.placed',
			aggregateType: 'order_group',
			aggregateId: String(group.id),
			payload: {
				order_group_id: group.id,
				list_id: listId,
				customer_id: userId,
				order_ids: placedOrders.map((o) => o.id),
				total_paise: group.total_paise,
			},
		});

		await client.query(`DELETE FROM checkout_previews WHERE id = $1`, [prev.id]);

		await client.query('COMMIT');

		const orders = [];
		for (const o of placedOrders) {
			orders.push(await loadOrder(o.id));
		}

		return { order_group: group, orders, replayed: false };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

async function loadGroupOrders(orderGroupId) {
	const links = await pool.query(
		`SELECT order_id FROM order_group_orders WHERE order_group_id = $1 ORDER BY order_id`,
		[orderGroupId]
	);
	const orders = [];
	for (const row of links.rows) {
		orders.push(await loadOrder(row.order_id));
	}
	return orders;
}
