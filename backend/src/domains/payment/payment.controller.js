import pool from '../../db.js';
import { writeLedgerEntry } from '../ledger/ledger.service.js';
import { enqueueOutbox } from '../../events/outbox.js';
import {
	razorpayConfigured,
	verifyCheckoutSignature,
	verifyWebhookSignature,
	createRazorpayOrder,
} from '../../services/razorpay.js';
import { processRefund } from '../../services/refund.js';
import { writeAuditLog } from '../../services/audit.js';

function commissionRateBps() {
	return Number(process.env.COMMISSION_RATE_BPS || 1000);
}

/**
 * Create payment for an order or service booking.
 * body: { order_id? | booking_id?, provider: cod|razorpay }
 */
export async function createPayment(req, res) {
	const orderId = req.body.order_id != null ? Number(req.body.order_id) : null;
	const bookingId = req.body.booking_id != null ? Number(req.body.booking_id) : null;
	const provider = String(req.body.provider || 'cod');
	const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key || null;

	if (!orderId && !bookingId) {
		return res.status(400).json({ error: 'order_id or booking_id required' });
	}
	if (orderId && bookingId) {
		return res.status(400).json({ error: 'pass only one of order_id or booking_id' });
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

		let customerId;
		let amountPaise;
		let receipt;
		let notes;

		if (orderId) {
			const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
				orderId,
			]);
			if (orderRes.rowCount === 0) {
				await client.query('ROLLBACK');
				return res.status(404).json({ error: 'Order not found' });
			}
			const order = orderRes.rows[0];
			if (
				order.customer_id !== req.user.id &&
				!['super_admin', 'support'].includes(req.user.role)
			) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Forbidden' });
			}
			customerId = order.customer_id;
			amountPaise = order.total_paise;
			receipt = `order_${order.id}`;
			notes = { grabit_order_id: String(order.id) };
		} else {
			const bookingRes = await client.query(
				`SELECT * FROM service_bookings WHERE id = $1 FOR UPDATE`,
				[bookingId]
			);
			if (bookingRes.rowCount === 0) {
				await client.query('ROLLBACK');
				return res.status(404).json({ error: 'Booking not found' });
			}
			const booking = bookingRes.rows[0];
			if (
				booking.customer_id !== req.user.id &&
				!['super_admin', 'support'].includes(req.user.role)
			) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Forbidden' });
			}
			customerId = booking.customer_id;
			amountPaise = booking.price_paise;
			receipt = `booking_${booking.id}`;
			notes = { grabit_booking_id: String(booking.id) };
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
			const rp = await createRazorpayOrder({
				amountPaise,
				receipt,
				notes,
			});
			if (!rp.ok) {
				await client.query('ROLLBACK');
				return res.status(502).json({ error: 'Razorpay order create failed', detail: rp.data });
			}
			razorpayOrderId = rp.data.id;
			razorpayPayload = {
				key_id: process.env.RAZORPAY_KEY_ID,
				razorpay_order_id: rp.data.id,
				amount: rp.data.amount,
				currency: rp.data.currency,
			};
		}

		const status = provider === 'cod' ? 'pending' : 'created';
		const paymentStatus = provider === 'cod' ? 'cod_pending' : 'pending';

		const payment = await client.query(
			`INSERT INTO payments (
				order_id, booking_id, customer_id, provider, amount_paise, status,
				razorpay_order_id, idempotency_key, meta
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
			 RETURNING *`,
			[
				orderId,
				bookingId,
				customerId,
				provider,
				amountPaise,
				status,
				razorpayOrderId,
				idempotencyKey,
				JSON.stringify(razorpayPayload || {}),
			]
		);

		if (orderId) {
			await client.query(
				`UPDATE orders SET payment_method = $1, payment_status = $2, updated_at = NOW()
				 WHERE id = $3`,
				[provider, paymentStatus, orderId]
			);
		} else {
			await client.query(
				`UPDATE service_bookings
				 SET payment_method = $1, payment_status = $2, updated_at = NOW()
				 WHERE id = $3`,
				[provider, paymentStatus, bookingId]
			);
		}

		await enqueueOutbox(client, {
			eventType: 'payment.created',
			aggregateType: 'payment',
			aggregateId: String(payment.rows[0].id),
			payload: {
				payment_id: payment.rows[0].id,
				order_id: orderId,
				booking_id: bookingId,
				provider,
				customer_id: customerId,
			},
		});

		await client.query('COMMIT');
		return res.status(201).json({
			payment: payment.rows[0],
			razorpay: razorpayPayload,
		});
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Payment already exists for target' });
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
		booking_id: bookingIdRaw,
		razorpay_order_id,
		razorpay_payment_id,
		razorpay_signature,
	} = req.body;
	const orderId = orderIdRaw != null ? Number(orderIdRaw) : null;
	const bookingId = bookingIdRaw != null ? Number(bookingIdRaw) : null;
	if (!orderId && !bookingId) {
		return res.status(400).json({ error: 'order_id or booking_id required' });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const paymentRes = orderId
			? await client.query(
					`SELECT * FROM payments WHERE order_id = $1 AND provider = 'razorpay' FOR UPDATE`,
					[orderId]
				)
			: await client.query(
					`SELECT * FROM payments WHERE booking_id = $1 AND provider = 'razorpay' FOR UPDATE`,
					[bookingId]
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

		const ok = verifyCheckoutSignature({
			razorpay_order_id,
			razorpay_payment_id,
			razorpay_signature,
		});

		if (!ok) {
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
		if (payment.order_id) {
			await client.query(
				`UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
				[payment.order_id]
			);
		}
		if (payment.booking_id) {
			await client.query(
				`UPDATE service_bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
				[payment.booking_id]
			);
		}
		await enqueueOutbox(client, {
			eventType: 'payment.paid',
			aggregateType: 'payment',
			aggregateId: String(payment.id),
			payload: {
				payment_id: payment.id,
				order_id: payment.order_id,
				booking_id: payment.booking_id,
				customer_id: payment.customer_id,
			},
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
		const raw = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);
		if (signature && !verifyWebhookSignature(raw, signature)) {
			return res.status(400).json({ error: 'Invalid webhook signature' });
		}

		const event = req.body?.event;
		const entity = req.body?.payload?.payment?.entity;
		if (event === 'payment.captured' && entity?.order_id) {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const pay = await client.query(
					`UPDATE payments
					 SET status = 'paid', razorpay_payment_id = $1, updated_at = NOW()
					 WHERE razorpay_order_id = $2 AND status <> 'paid'
					 RETURNING *`,
					[entity.id, entity.order_id]
				);
				if (pay.rowCount > 0) {
					const p = pay.rows[0];
					if (p.order_id) {
						await client.query(
							`UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
							[p.order_id]
						);
					}
					if (p.booking_id) {
						await client.query(
							`UPDATE service_bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
							[p.booking_id]
						);
					}
					await enqueueOutbox(client, {
						eventType: 'payment.paid',
						aggregateType: 'payment',
						aggregateId: String(p.id),
						payload: {
							payment_id: p.id,
							order_id: p.order_id,
							booking_id: p.booking_id,
							source: 'webhook',
						},
					});
				}
				await client.query('COMMIT');
			} catch (err) {
				await client.query('ROLLBACK');
				throw err;
			} finally {
				client.release();
			}
		}

		return res.json({ ok: true });
	} catch (err) {
		console.error('paymentWebhook', err);
		return res.status(500).json({ error: 'Webhook failed' });
	}
}

export async function refundPayment(req, res) {
	const orderId = req.body.order_id != null ? Number(req.body.order_id) : null;
	const bookingId = req.body.booking_id != null ? Number(req.body.booking_id) : null;
	const amountPaise = req.body.amount_paise != null ? Number(req.body.amount_paise) : null;
	const reason = req.body.reason || 'refund';

	if (!orderId && !bookingId) {
		return res.status(400).json({ error: 'order_id or booking_id required' });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await processRefund(client, {
			orderId,
			bookingId,
			amountPaise,
			reason,
			actorUserId: req.user.id,
		});
		await writeAuditLog(client, {
			actorUserId: req.user.id,
			action: 'payment.refund',
			entityType: 'refund',
			entityId: result.refund.id,
			meta: { order_id: orderId, booking_id: bookingId, amount_paise: result.refund.amount_paise },
			ip: req.ip,
		});
		await client.query('COMMIT');
		return res.status(201).json(result);
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === 'PAYMENT_NOT_FOUND') {
			return res.status(404).json({ error: err.message });
		}
		if (['INVALID_AMOUNT', 'ALREADY_REFUNDED', 'REFUND_TARGET'].includes(err.code)) {
			return res.status(400).json({ error: err.message, code: err.code });
		}
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
