import pool from '../db.js';
import { enqueueOutbox } from '../events/outbox.js';
import { applyStockForOrderItems } from '../domains/inventory/inventory.service.js';
import { canTransition, stockActionFor } from '../domains/orders/order.state.js';

/**
 * Expire stale `placed` orders that vendors never accepted.
 * Releases reserved stock + emits outbox events.
 */
export async function expireStaleOrders(db = pool, {
	ttlMinutes = Number(process.env.ORDER_ACCEPT_TTL_MINUTES || 30),
	limit = Number(process.env.ORDER_EXPIRE_BATCH || 50),
} = {}) {
	const client = await db.connect();
	let expired = 0;
	try {
		await client.query('BEGIN');
		const rows = await client.query(
			`SELECT id, status, customer_id, vendor_id, fulfillment_mode, created_at
			 FROM orders
			 WHERE status = 'placed'
			   AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
			 ORDER BY id ASC
			 LIMIT $2
			 FOR UPDATE SKIP LOCKED`,
			[ttlMinutes, limit]
		);

		for (const order of rows.rows) {
			if (!canTransition(order.status, 'expired')) continue;
			const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [
				order.id,
			]);
			const stockAction = stockActionFor(order.status, 'expired');
			if (stockAction) {
				await applyStockForOrderItems(client, items.rows, stockAction);
			}

			await client.query(
				`UPDATE orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
				[order.id]
			);
			await client.query(
				`UPDATE delivery_jobs SET status = 'cancelled', updated_at = NOW()
				 WHERE order_id = $1 AND status IN ('unassigned','assigned','picked_up')`,
				[order.id]
			);
			await client.query(
				`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
				 VALUES ($1, $2, 'expired', NULL, $3::jsonb)`,
				[
					order.id,
					order.status,
					JSON.stringify({ reason: 'auto_expire', ttl_minutes: ttlMinutes }),
				]
			);
			await enqueueOutbox(client, {
				eventType: 'order.expired',
				aggregateType: 'order',
				aggregateId: String(order.id),
				payload: {
					order_id: order.id,
					customer_id: order.customer_id,
					vendor_id: order.vendor_id,
					from: order.status,
					to: 'expired',
					fulfillment_mode: order.fulfillment_mode,
				},
			});
			expired += 1;
		}

		await client.query('COMMIT');
		return { expired, scanned: rows.rowCount, ttlMinutes };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}
