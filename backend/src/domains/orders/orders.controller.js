import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { applyStockForOrderItems } from '../inventory/inventory.service.js';
import { recordOrderPlacedLedger } from '../ledger/ledger.service.js';
import { canTransition, stockActionFor } from './order.state.js';
import { deliveryFeePaise, placeOrderForVendor, loadOrder } from './place-order.service.js';

/**
 * POST /orders
 * body: { vendor_id, items: [{ listing_id, qty }], payment_method?, delivery_address? }
 * header: Idempotency-Key
 */
export async function placeOrder(req) {
	const vendorId = Number(req.body.vendor_id);
	const items = Array.isArray(req.body.items) ? req.body.items : [];
	const paymentMethod = req.body.payment_method || 'cod';
	const deliveryAddress = req.body.delivery_address || null;

	if (!Number.isInteger(vendorId) || vendorId < 1) {
		return { status: 400, body: { error: 'vendor_id required' } };
	}
	if (!items.length) {
		return { status: 400, body: { error: 'items required' } };
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const { order } = await placeOrderForVendor(client, {
			customerId: req.user.id,
			vendorId,
			items,
			paymentMethod,
			deliveryAddress,
			idempotencyKey: req.idempotencyKey,
			actorUserId: req.user.id,
		});

		await client.query('COMMIT');

		const full = await loadOrder(order.id);
		return { status: 201, body: { order: full } };
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return { status: 409, body: { error: 'Duplicate order idempotency key' } };
		}
		if (err.code === 'STOCK_UNAVAILABLE') {
			return {
				status: 409,
				body: { error: 'Insufficient stock', listing_id: err.listingId, available_qty: err.availableQty },
			};
		}
		if (err.code === 'VENDOR_UNAVAILABLE') {
			return { status: 404, body: { error: 'Vendor unavailable' } };
		}
		if (err.code === 'VALIDATION' || err.code === 'LISTING_NOT_FOUND') {
			return { status: 400, body: { error: err.message } };
		}
		console.error('placeOrder', err);
		return { status: 500, body: { error: 'Failed to place order' } };
	} finally {
		client.release();
	}
}

export { loadOrder };

export async function listMyOrders(req, res) {
	try {
		const result = await pool.query(
			`SELECT o.*, v.business_name
			 FROM orders o
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.customer_id = $1
			 ORDER BY o.created_at DESC
			 LIMIT 50`,
			[req.user.id]
		);
		return res.json({ orders: result.rows });
	} catch (err) {
		console.error('listMyOrders', err);
		return res.status(500).json({ error: 'Failed to list orders' });
	}
}

export async function listVendorOrders(req, res) {
	try {
		const vendor = await pool.query(`SELECT id FROM vendors WHERE user_id = $1`, [req.user.id]);
		if (vendor.rowCount === 0) return res.status(404).json({ error: 'Vendor not found' });

		const result = await pool.query(
			`SELECT o.*
			 FROM orders o
			 WHERE o.vendor_id = $1
			 ORDER BY o.created_at DESC
			 LIMIT 50`,
			[vendor.rows[0].id]
		);
		return res.json({ orders: result.rows });
	} catch (err) {
		console.error('listVendorOrders', err);
		return res.status(500).json({ error: 'Failed to list vendor orders' });
	}
}

export async function getOrder(req, res) {
	try {
		const order = await loadOrder(Number(req.params.id));
		if (!order) return res.status(404).json({ error: 'Order not found' });

		const vendor = await pool.query(`SELECT id, user_id FROM vendors WHERE id = $1`, [order.vendor_id]);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin'].includes(req.user.role);

		if (!isCustomer && !isVendor && !isStaff) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		return res.json({ order });
	} catch (err) {
		console.error('getOrder', err);
		return res.status(500).json({ error: 'Failed to load order' });
	}
}

/**
 * Transition order status (vendor/customer cancel/staff).
 * body: { to_status, reason? }
 */
export async function transitionOrder(req, res) {
	const orderId = Number(req.params.id);
	const toStatus = String(req.body.to_status || '');
	const reason = req.body.reason || null;

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
		if (orderRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Order not found' });
		}

		const order = orderRes.rows[0];
		const vendor = await client.query(`SELECT * FROM vendors WHERE id = $1`, [order.vendor_id]);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin'].includes(req.user.role);

		if (!canTransition(order.status, toStatus)) {
			await client.query('ROLLBACK');
			return res.status(400).json({
				error: `Cannot transition ${order.status} → ${toStatus}`,
			});
		}

		const vendorActions = ['accepted', 'rejected', 'preparing', 'ready'];
		const deliveryActions = ['picked', 'delivered'];

		if (vendorActions.includes(toStatus) && !isVendor && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Vendor only' });
		}
		if (toStatus === 'cancelled' && !isCustomer && !isVendor && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Not allowed to cancel' });
		}
		if (deliveryActions.includes(toStatus) && !isVendor && !isStaff && req.user.role !== 'delivery') {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Delivery/vendor only' });
		}

		const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
		const stockAction = stockActionFor(order.status, toStatus);
		if (stockAction) {
			await applyStockForOrderItems(client, items.rows, stockAction);
		}

		await client.query(
			`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
			[toStatus, orderId]
		);

		await client.query(
			`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
			 VALUES ($1, $2, $3, $4, $5::jsonb)`,
			[orderId, order.status, toStatus, req.user.id, JSON.stringify({ reason })]
		);

		await enqueueOutbox(client, {
			eventType: `order.${toStatus}`,
			aggregateType: 'order',
			aggregateId: String(orderId),
			payload: {
				order_id: orderId,
				from: order.status,
				to: toStatus,
				actor_user_id: req.user.id,
			},
		});

		await client.query('COMMIT');
		const full = await loadOrder(orderId);
		return res.json({ order: full });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('transitionOrder', err);
		if (err.code?.startsWith('STOCK_')) {
			return res.status(409).json({ error: err.message, code: err.code });
		}
		return res.status(500).json({ error: 'Failed to update order' });
	} finally {
		client.release();
	}
}

export { deliveryFeePaise };
