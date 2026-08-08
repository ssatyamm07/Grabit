import { enqueueOutbox } from '../../events/outbox.js';
import { applyStockForOrderItems } from '../inventory/inventory.service.js';
import { recordOrderPlacedLedger } from '../ledger/ledger.service.js';
import pool from '../../db.js';
import { resolveFulfillmentMode } from './fulfillment.js';

export function deliveryFeePaise() {
	return Number(process.env.DEFAULT_DELIVERY_FEE_PAISE || 2000);
}

export async function loadOrder(orderId, client = pool) {
	const order = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
	if (order.rowCount === 0) return null;
	const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
	const events = await client.query(
		`SELECT * FROM order_events WHERE order_id = $1 ORDER BY id ASC`,
		[orderId]
	);
	return { ...order.rows[0], items: items.rows, events: events.rows };
}

/**
 * Place a single-vendor order inside an existing transaction.
 * Throws on stock/validation failure (caller rolls back).
 *
 * @returns {{ order: object, lineRows: object[], totalPaise: number, fee: number }}
 */
export async function placeOrderForVendor(client, {
	customerId,
	vendorId,
	items,
	paymentMethod = 'cod',
	deliveryAddress = null,
	idempotencyKey = null,
	orderGroupId = null,
	shoppingListId = null,
	actorUserId = null,
	deliveryFee = null,
	fulfillmentMode = null,
}) {
	if (!Number.isInteger(vendorId) || vendorId < 1) {
		const err = new Error('vendor_id required');
		err.code = 'VALIDATION';
		throw err;
	}
	if (!Array.isArray(items) || !items.length) {
		const err = new Error('items required');
		err.code = 'VALIDATION';
		throw err;
	}

	const vendor = await client.query(
		`SELECT * FROM vendors WHERE id = $1 AND is_approved = TRUE AND is_open = TRUE FOR UPDATE`,
		[vendorId]
	);
	if (vendor.rowCount === 0) {
		const err = new Error('Vendor unavailable');
		err.code = 'VENDOR_UNAVAILABLE';
		err.vendorId = vendorId;
		throw err;
	}

	const lineRows = [];
	let subtotal = 0;

	for (const raw of items) {
		const listingId = Number(raw.listing_id);
		const qty = Number(raw.qty);
		if (!Number.isInteger(listingId) || !Number.isInteger(qty) || qty < 1) {
			const err = new Error('Each item needs listing_id and qty >= 1');
			err.code = 'VALIDATION';
			throw err;
		}

		const listing = await client.query(
			`SELECT vl.*, mp.name, mp.id AS master_product_id,
			        COALESCE(vi.qty, 0) - COALESCE(vi.reserved_qty, 0) AS available_qty
			 FROM vendor_listings vl
			 JOIN master_products mp ON mp.id = vl.master_product_id
			 LEFT JOIN vendor_inventory vi ON vi.vendor_listing_id = vl.id
			 WHERE vl.id = $1 AND vl.vendor_id = $2 AND vl.is_active = TRUE
			 FOR UPDATE OF vl`,
			[listingId, vendorId]
		);

		if (listing.rowCount === 0) {
			const err = new Error(`Listing ${listingId} not found for vendor`);
			err.code = 'LISTING_NOT_FOUND';
			err.listingId = listingId;
			throw err;
		}

		const row = listing.rows[0];
		if (Number(row.available_qty) < qty) {
			const err = new Error('Insufficient stock');
			err.code = 'STOCK_UNAVAILABLE';
			err.listingId = listingId;
			err.availableQty = Number(row.available_qty);
			throw err;
		}

		const lineTotal = row.price_paise * qty;
		subtotal += lineTotal;
		lineRows.push({
			vendor_listing_id: row.id,
			master_product_id: row.master_product_id,
			name_snapshot: row.name,
			unit_price_paise: row.price_paise,
			qty,
			line_total_paise: lineTotal,
		});
	}

	const fee = deliveryFee != null ? deliveryFee : deliveryFeePaise();
	const total = subtotal + fee;
	let mode;
	try {
		mode = resolveFulfillmentMode(
			fulfillmentMode,
			vendor.rows[0].fulfillment_mode_default || 'either'
		);
	} catch (err) {
		throw err;
	}

	const orderIns = await client.query(
		`INSERT INTO orders (
			customer_id, vendor_id, status, fulfillment_type,
			total_paise, delivery_fee_paise, payment_method,
			delivery_address_snapshot, idempotency_key, placed_at,
			order_group_id, shopping_list_id, fulfillment_mode
		 ) VALUES ($1,$2,'placed',$3,$4,$5,$6,$7::jsonb,$8,NOW(),$9,$10,$11)
		 RETURNING *`,
		[
			customerId,
			vendorId,
			vendor.rows[0].fulfillment_type,
			total,
			fee,
			paymentMethod,
			JSON.stringify(deliveryAddress),
			idempotencyKey,
			orderGroupId,
			shoppingListId,
			mode,
		]
	);

	const order = orderIns.rows[0];

	for (const line of lineRows) {
		await client.query(
			`INSERT INTO order_items
			 (order_id, vendor_listing_id, master_product_id, name_snapshot, unit_price_paise, qty, line_total_paise)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			[
				order.id,
				line.vendor_listing_id,
				line.master_product_id,
				line.name_snapshot,
				line.unit_price_paise,
				line.qty,
				line.line_total_paise,
			]
		);
	}

	await applyStockForOrderItems(client, lineRows, 'reserve');

	await client.query(
		`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
		 VALUES ($1, 'draft', 'placed', $2, $3::jsonb)`,
		[
			order.id,
			actorUserId || customerId,
			JSON.stringify({ payment_method: paymentMethod, order_group_id: orderGroupId }),
		]
	);

	await recordOrderPlacedLedger(client, {
		orderId: order.id,
		customerId,
		vendorId,
		totalPaise: total,
	});

	await enqueueOutbox(client, {
		eventType: 'order.placed',
		aggregateType: 'order',
		aggregateId: String(order.id),
		payload: {
			order_id: order.id,
			customer_id: customerId,
			vendor_id: vendorId,
			total_paise: total,
			order_group_id: orderGroupId,
		},
	});

	return { order, lineRows, totalPaise: total, fee, subtotal };
}
