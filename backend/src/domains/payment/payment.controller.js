import crypto from 'crypto';
import pool from '../../db.js';
import { writeLedgerEntry } from '../ledger/ledger.service.js';
import { enqueueOutbox } from '../../events/outbox.js';

function razorpayConfigured() {
	return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

function commissionRateBps() {
	return Number(process.env.COMMISSION_RATE_BPS || 1000); // 10%
}

/**
 * Create payment for an order.
 * COD: records payment as cod_pending / paid at delivery semantics.
 * Razorpay: creates local row + returns key_id + order stub (real Razorpay Orders API when keys set).
 */
export async function createPayment(req, res) {
	const orderId = Number(req.body.order_id);
	const provider = String(req.body.provider || 'cod');
	const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key || null;

	if (!Number.isInteger(orderId) || orderId < 1) {
		return res.status(400).json({ error: 'order_id required' });
	}
	if (!['cod', 'razorpay'].includes(provider)) {
		return res.status(400).json({ error: 'provider must be cod|razorpay' });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		if (idempotencyKey) {
			const existing = await client.query(
				`SELECT * FROM payments WHERE customer_id = $1 AND idempotency_key = $2`,
				[req.user.id, idempotencyKey]
			);
			if (existing.rowCount > 0) {
				await client.query('COMMIT');
				return res.json({ payment: existing.rows[0], replayed: true });
			}
		}

		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
			orderId,
		]);
		if (orderRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Order not found' });
		}
		const order = orderRes.rows[0];
		if (order.customer_id !== req.user.id && !['super_admin', 'support'].includes(req.user.role)) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Forbidden' });
		}

		if (provider === 'razorpay' && !razorpayConfigured()) {
			await client.query('ROLLBACK');
			return res.status(503).json({
				error: 'Razorpay not configured',
				hint: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET',
			});
		}

		let razorpayOrderId = null;
		let razorpayPayload = null;

		if (provider === 'razorpay') {
			const auth = Buffer.from(
				`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
			).toString('base64');
			const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
				method: 'POST',
				headers: {
					Authorization: `Basic ${auth}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					amount: order.total_paise,
					currency: 'INR',
					receipt: `order_${order.id}`,
					notes: { grabit_order_id: String(order.id) },
				}),
			});
			const rpData = await rpRes.json();
			if (!rpRes.ok) {
				await client.query('ROLLBACK');
				return res.status(502).json({ error: 'Razorpay order create failed', detail: rpData });
			}
			razorpayOrderId = rpData.id;
			razorpayPayload = {
				key_id: process.env.RAZORPAY_KEY_ID,
				razorpay_order_id: rpData.id,
				amount: rpData.amount,
				currency: rpData.currency,
			};
		}

		const status = provider === 'cod' ? 'pending' : 'created';
		const paymentStatus = provider === 'cod' ? 'cod_pending' : 'pending';

		const payment = await client.query(
			`INSERT INTO payments (
				order_id, customer_id, provider, amount_paise, status,
				razorpay_order_id, idempotency_key, meta
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
			 RETURNING *`,
			[
				orderId,
				order.customer_id,
				provider,
				order.total_paise,
				status,
				razorpayOrderId,
				idempotencyKey,
				JSON.stringify(razorpayPayload || {}),
			]
		);

		await client.query(
			`UPDATE orders SET payment_method = $1, payment_status = $2, updated_at = NOW()
			 WHERE id = $3`,
			[provider, paymentStatus, orderId]
		);

		await enqueueOutbox(client, {
			eventType: 'payment.created',
			aggregateType: 'payment',
			aggregateId: String(payment.rows[0].id),
			payload: { payment_id: payment.rows[0].id, order_id: orderId, provider },
		});

		await client.query('COMMIT');
		return res.status(201).json({
			payment: payment.rows[0],
			razorpay: razorpayPayload,
		});
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Payment already exists for order' });
		}
		console.error('createPayment', err);
		return res.status(500).json({ error: 'Failed to create payment' });
	} finally {
		client.release();
	}
}

export async function verifyPayment(req, res) {
	const {
		order_id: orderIdRaw,
		razorpay_order_id,
		razorpay_payment_id,
		razorpay_signature,
	} = req.body;
	const orderId = Number(orderIdRaw);
	if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'order_id required' });

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const paymentRes = await client.query(
			`SELECT * FROM payments WHERE order_id = $1 AND provider = 'razorpay' FOR UPDATE`,
			[orderId]
		);
		if (paymentRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Payment not found' });
		}
		const payment = paymentRes.rows[0];
		if (payment.customer_id !== req.user.id && !['super_admin', 'support'].includes(req.user.role)) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Forbidden' });
		}

		if (!razorpayConfigured()) {
			await client.query('ROLLBACK');
			return res.status(503).json({ error: 'Razorpay not configured' });
		}

		const body = `${razorpay_order_id}|${razorpay_payment_id}`;
		const expected = crypto
			.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
			.update(body)
			.digest('hex');

		if (expected !== razorpay_signature) {
			await client.query(
				`UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`,
				[payment.id]
			);
			await client.query('COMMIT');
			return res.status(400).json({ error: 'Invalid signature' });
		}

		const updated = await client.query(
			`UPDATE payments
			 SET status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, updated_at = NOW()
			 WHERE id = $3 RETURNING *`,
			[razorpay_payment_id, razorpay_signature, payment.id]
		);
		await client.query(
			`UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
			[orderId]
		);
		await enqueueOutbox(client, {
			eventType: 'payment.paid',
			aggregateType: 'payment',
			aggregateId: String(payment.id),
			payload: { payment_id: payment.id, order_id: orderId },
		});
		await client.query('COMMIT');
		return res.json({ payment: updated.rows[0], verified: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('verifyPayment', err);
		return res.status(500).json({ error: 'Failed to verify payment' });
	} finally {
		client.release();
	}
}

/** Razorpay webhook — signature via X-Razorpay-Signature */
export async function paymentWebhook(req, res) {
	try {
		if (!razorpayConfigured()) {
			return res.status(503).json({ error: 'Razorpay not configured' });
		}
		const signature = req.headers['x-razorpay-signature'];
		const raw = JSON.stringify(req.body);
		const expected = crypto
			.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET)
			.update(raw)
			.digest('hex');

		if (signature && signature !== expected) {
			return res.status(400).json({ error: 'Invalid webhook signature' });
		}

		const event = req.body?.event;
		const entity = req.body?.payload?.payment?.entity;
		if (event === 'payment.captured' && entity?.order_id) {
			await pool.query(
				`UPDATE payments
				 SET status = 'paid', razorpay_payment_id = $1, updated_at = NOW()
				 WHERE razorpay_order_id = $2 AND status <> 'paid'`,
				[entity.id, entity.order_id]
			);
			await pool.query(
				`UPDATE orders o
				 SET payment_status = 'paid', updated_at = NOW()
				 FROM payments p
				 WHERE p.order_id = o.id AND p.razorpay_order_id = $1`,
				[entity.order_id]
			);
		}

		return res.json({ ok: true });
	} catch (err) {
		console.error('paymentWebhook', err);
		return res.status(500).json({ error: 'Webhook failed' });
	}
}

export async function refundPayment(req, res) {
	const orderId = Number(req.body.order_id);
	const amountPaise = req.body.amount_paise != null ? Number(req.body.amount_paise) : null;
	const reason = req.body.reason || 'refund';

	if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'order_id required' });

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const paymentRes = await client.query(
			`SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
			[orderId]
		);
		if (paymentRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Payment not found' });
		}
		const payment = paymentRes.rows[0];
		const refundAmount = amountPaise || payment.amount_paise;
		if (!Number.isInteger(refundAmount) || refundAmount <= 0 || refundAmount > payment.amount_paise) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'invalid amount_paise' });
		}

		const order = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
		const vendorId = order.rows[0].vendor_id;
		const customerId = order.rows[0].customer_id;

		await writeLedgerEntry(client, {
			accountRef: `vendor:${vendorId}`,
			direction: 'debit',
			amountPaise: refundAmount,
			reason: 'refund',
			referenceType: 'order',
			referenceId: String(orderId),
		});
		await writeLedgerEntry(client, {
			accountRef: `customer:${customerId}`,
			direction: 'credit',
			amountPaise: refundAmount,
			reason: 'refund',
			referenceType: 'order',
			referenceId: String(orderId),
		});

		const refund = await client.query(
			`INSERT INTO refunds (payment_id, order_id, amount_paise, reason, status, created_by)
			 VALUES ($1,$2,$3,$4,'processed',$5) RETURNING *`,
			[payment.id, orderId, refundAmount, reason, req.user.id]
		);

		const newStatus =
			refundAmount >= payment.amount_paise ? 'refunded' : 'partial_refund';
		await client.query(`UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2`, [
			newStatus,
			payment.id,
		]);
		await client.query(
			`UPDATE orders SET payment_status = 'refunded', status = CASE
			   WHEN status NOT IN ('cancelled','rejected') THEN 'refunded' ELSE status END,
			 updated_at = NOW() WHERE id = $1`,
			[orderId]
		);

		await client.query('COMMIT');
		return res.status(201).json({ refund: refund.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('refundPayment', err);
		return res.status(500).json({ error: 'Failed to refund' });
	} finally {
		client.release();
	}
}

export async function settleCommission(req, res) {
	const orderId = Number(req.body.order_id);
	if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'order_id required' });

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
			orderId,
		]);
		if (orderRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Order not found' });
		}
		const order = orderRes.rows[0];
		if (order.status !== 'delivered') {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Order must be delivered before settlement' });
		}

		const rate = commissionRateBps();
		const commission = Math.round((order.total_paise * rate) / 10000);
		const vendorNet = order.total_paise - commission;

		const settlement = await client.query(
			`INSERT INTO commission_settlements (
				vendor_id, order_id, order_total_paise, commission_paise, vendor_net_paise, rate_bps, created_by
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7)
			 ON CONFLICT (order_id) DO UPDATE SET status = 'settled'
			 RETURNING *`,
			[order.vendor_id, orderId, order.total_paise, commission, vendorNet, rate, req.user.id]
		);

		await writeLedgerEntry(client, {
			accountRef: `vendor:${order.vendor_id}`,
			direction: 'debit',
			amountPaise: Math.max(commission, 1),
			reason: 'commission',
			referenceType: 'order',
			referenceId: String(orderId),
		});
		await writeLedgerEntry(client, {
			accountRef: 'platform:commission',
			direction: 'credit',
			amountPaise: Math.max(commission, 1),
			reason: 'commission',
			referenceType: 'order',
			referenceId: String(orderId),
		});

		await client.query('COMMIT');
		return res.status(201).json({ settlement: settlement.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Already settled' });
		}
		console.error('settleCommission', err);
		return res.status(500).json({ error: 'Failed to settle' });
	} finally {
		client.release();
	}
}
