import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { processRefund } from '../../services/refund.js';
import { writeAuditLog } from '../../services/audit.js';

const STAFF = ['super_admin', 'support', 'regional_admin'];

export async function openDispute(req, res) {
	try {
		const orderId = Number(req.body.order_id);
		const reason = String(req.body.reason || '').trim();
		if (!Number.isInteger(orderId) || !reason) {
			return res.status(400).json({ error: 'order_id and reason required' });
		}

		const order = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
		if (order.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

		const o = order.rows[0];
		const vendor = await pool.query(`SELECT user_id FROM vendors WHERE id = $1`, [o.vendor_id]);
		const isCustomer = o.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = STAFF.includes(req.user.role);
		if (!isCustomer && !isVendor && !isStaff) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const against = req.body.against_role || (isCustomer ? 'vendor' : 'customer');
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const dispute = await client.query(
				`INSERT INTO disputes (order_id, opened_by, against_role, reason, details, status)
				 VALUES ($1,$2,$3,$4,$5,'open') RETURNING *`,
				[orderId, req.user.id, against, reason, req.body.details || null]
			);
			await enqueueOutbox(client, {
				eventType: 'dispute.opened',
				aggregateType: 'dispute',
				aggregateId: String(dispute.rows[0].id),
				payload: {
					dispute_id: dispute.rows[0].id,
					order_id: orderId,
					opened_by: req.user.id,
					reason,
				},
			});
			await writeAuditLog(client, {
				actorUserId: req.user.id,
				action: 'dispute.opened',
				entityType: 'dispute',
				entityId: dispute.rows[0].id,
				meta: { order_id: orderId, reason },
				ip: req.ip,
			});
			await client.query('COMMIT');
			return res.status(201).json({ dispute: dispute.rows[0] });
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		console.error('openDispute', err);
		return res.status(500).json({ error: 'Failed to open dispute' });
	}
}

export async function listDisputes(req, res) {
	try {
		const status = req.query.status ? String(req.query.status) : null;
		const isStaff = STAFF.includes(req.user.role);

		let result;
		if (isStaff) {
			result = await pool.query(
				`SELECT d.*, o.vendor_id, o.customer_id, o.status AS order_status
				 FROM disputes d
				 JOIN orders o ON o.id = d.order_id
				 WHERE ($1::text IS NULL OR d.status = $1)
				 ORDER BY d.created_at DESC
				 LIMIT 100`,
				[status]
			);
		} else {
			result = await pool.query(
				`SELECT d.*, o.vendor_id, o.customer_id, o.status AS order_status
				 FROM disputes d
				 JOIN orders o ON o.id = d.order_id
				 LEFT JOIN vendors v ON v.id = o.vendor_id
				 WHERE (o.customer_id = $1 OR v.user_id = $1)
				   AND ($2::text IS NULL OR d.status = $2)
				 ORDER BY d.created_at DESC
				 LIMIT 100`,
				[req.user.id, status]
			);
		}
		return res.json({ disputes: result.rows });
	} catch (err) {
		console.error('listDisputes', err);
		return res.status(500).json({ error: 'Failed to list disputes' });
	}
}

export async function getDispute(req, res) {
	try {
		const id = Number(req.params.id);
		const result = await pool.query(
			`SELECT d.*, o.vendor_id, o.customer_id
			 FROM disputes d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`,
			[id]
		);
		if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
		const d = result.rows[0];
		const vendor = await pool.query(`SELECT user_id FROM vendors WHERE id = $1`, [d.vendor_id]);
		const allowed =
			STAFF.includes(req.user.role) ||
			d.customer_id === req.user.id ||
			vendor.rows[0]?.user_id === req.user.id ||
			d.opened_by === req.user.id;
		if (!allowed) return res.status(403).json({ error: 'Forbidden' });
		return res.json({ dispute: d });
	} catch (err) {
		console.error('getDispute', err);
		return res.status(500).json({ error: 'Failed to load dispute' });
	}
}

/**
 * Resolve dispute. Optional closed-loop refund:
 * body: { status, resolution, issue_refund?: boolean, refund_amount_paise?: number }
 */
export async function resolveDispute(req, res) {
	try {
		if (!STAFF.includes(req.user.role)) {
			return res.status(403).json({ error: 'Staff only' });
		}
		const id = Number(req.params.id);
		const status = String(req.body.status || 'resolved');
		if (!['resolved', 'rejected', 'escalated', 'in_review'].includes(status)) {
			return res.status(400).json({ error: 'invalid status' });
		}

		const issueRefund = Boolean(req.body.issue_refund);
		if (issueRefund && status !== 'resolved') {
			return res.status(400).json({ error: 'issue_refund only allowed when status=resolved' });
		}

		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const result = await client.query(
				`UPDATE disputes
				 SET status = $1,
				     resolution = $2,
				     resolved_by = $3,
				     resolved_at = CASE WHEN $1 IN ('resolved','rejected') THEN NOW() ELSE resolved_at END,
				     updated_at = NOW()
				 WHERE id = $4
				 RETURNING *`,
				[status, req.body.resolution || null, req.user.id, id]
			);
			if (result.rowCount === 0) {
				await client.query('ROLLBACK');
				return res.status(404).json({ error: 'Not found' });
			}

			let refund = null;
			if (issueRefund) {
				const refundResult = await processRefund(client, {
					orderId: result.rows[0].order_id,
					amountPaise:
						req.body.refund_amount_paise != null
							? Number(req.body.refund_amount_paise)
							: null,
					reason: req.body.resolution || 'dispute_resolution',
					actorUserId: req.user.id,
					disputeId: id,
				});
				refund = refundResult.refund;
			}

			await enqueueOutbox(client, {
				eventType: `dispute.${status}`,
				aggregateType: 'dispute',
				aggregateId: String(id),
				payload: {
					dispute_id: id,
					status,
					resolved_by: req.user.id,
					order_id: result.rows[0].order_id,
					refund_id: refund?.id || null,
				},
			});
			await writeAuditLog(client, {
				actorUserId: req.user.id,
				action: `dispute.${status}`,
				entityType: 'dispute',
				entityId: id,
				meta: {
					order_id: result.rows[0].order_id,
					issue_refund: issueRefund,
					refund_id: refund?.id || null,
				},
				ip: req.ip,
			});
			await client.query('COMMIT');
			return res.json({ dispute: result.rows[0], refund });
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		console.error('resolveDispute', err);
		if (err.code === 'PAYMENT_NOT_FOUND') {
			return res.status(404).json({ error: 'No payment to refund for this order' });
		}
		if (['INVALID_AMOUNT', 'ALREADY_REFUNDED'].includes(err.code)) {
			return res.status(400).json({ error: err.message, code: err.code });
		}
		return res.status(500).json({ error: 'Failed to update dispute' });
	}
}
