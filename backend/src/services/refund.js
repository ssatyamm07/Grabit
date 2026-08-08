import { writeLedgerEntry } from '../domains/ledger/ledger.service.js';
import { enqueueOutbox } from '../events/outbox.js';

/**
 * Process refund inside an open transaction.
 * Works for order payments (and booking payments when order_id null).
 */
export async function processRefund(client, {
	orderId = null,
	bookingId = null,
	amountPaise = null,
	reason = 'refund',
	actorUserId = null,
	disputeId = null,
}) {
	let paymentRes;
	if (orderId != null) {
		paymentRes = await client.query(
			`SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
			[orderId]
		);
	} else if (bookingId != null) {
		paymentRes = await client.query(
			`SELECT * FROM payments WHERE booking_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
			[bookingId]
		);
	} else {
		const err = new Error('order_id or booking_id required');
		err.code = 'REFUND_TARGET';
		throw err;
	}

	if (paymentRes.rowCount === 0) {
		const err = new Error('Payment not found');
		err.code = 'PAYMENT_NOT_FOUND';
		throw err;
	}

	const payment = paymentRes.rows[0];
	if (['refunded'].includes(payment.status)) {
		const err = new Error('Payment already refunded');
		err.code = 'ALREADY_REFUNDED';
		throw err;
	}

	const refundAmount = amountPaise != null ? Number(amountPaise) : payment.amount_paise;
	if (!Number.isInteger(refundAmount) || refundAmount <= 0 || refundAmount > payment.amount_paise) {
		const err = new Error('invalid amount_paise');
		err.code = 'INVALID_AMOUNT';
		throw err;
	}

	let vendorId = null;
	let customerId = payment.customer_id;
	const targetOrderId = payment.order_id || orderId;
	const targetBookingId = payment.booking_id || bookingId;

	if (targetOrderId) {
		const order = await client.query(`SELECT * FROM orders WHERE id = $1`, [targetOrderId]);
		vendorId = order.rows[0]?.vendor_id;
		customerId = order.rows[0]?.customer_id || customerId;
	} else if (targetBookingId) {
		const booking = await client.query(`SELECT * FROM service_bookings WHERE id = $1`, [
			targetBookingId,
		]);
		vendorId = booking.rows[0]?.vendor_id;
		customerId = booking.rows[0]?.customer_id || customerId;
	}

	if (vendorId != null) {
		await writeLedgerEntry(client, {
			accountRef: `vendor:${vendorId}`,
			direction: 'debit',
			amountPaise: refundAmount,
			reason: 'refund',
			referenceType: targetOrderId ? 'order' : 'service_booking',
			referenceId: String(targetOrderId || targetBookingId),
		});
	}
	await writeLedgerEntry(client, {
		accountRef: `customer:${customerId}`,
		direction: 'credit',
		amountPaise: refundAmount,
		reason: 'refund',
		referenceType: targetOrderId ? 'order' : 'service_booking',
		referenceId: String(targetOrderId || targetBookingId),
	});

	const refund = await client.query(
		`INSERT INTO refunds (payment_id, order_id, booking_id, amount_paise, reason, status, created_by, dispute_id)
		 VALUES ($1,$2,$3,$4,$5,'processed',$6,$7) RETURNING *`,
		[
			payment.id,
			targetOrderId,
			targetBookingId,
			refundAmount,
			reason,
			actorUserId,
			disputeId || null,
		]
	);

	const newStatus = refundAmount >= payment.amount_paise ? 'refunded' : 'partial_refund';
	await client.query(`UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2`, [
		newStatus,
		payment.id,
	]);

	if (targetOrderId) {
		await client.query(
			`UPDATE orders SET payment_status = 'refunded', status = CASE
			   WHEN status NOT IN ('cancelled','rejected','expired') THEN 'refunded' ELSE status END,
			 updated_at = NOW() WHERE id = $1`,
			[targetOrderId]
		);
	}
	if (targetBookingId) {
		await client.query(
			`UPDATE service_bookings
			 SET payment_status = 'refunded', updated_at = NOW()
			 WHERE id = $1`,
			[targetBookingId]
		);
	}

	await enqueueOutbox(client, {
		eventType: 'payment.refunded',
		aggregateType: 'payment',
		aggregateId: String(payment.id),
		payload: {
			payment_id: payment.id,
			order_id: targetOrderId,
			booking_id: targetBookingId,
			amount_paise: refundAmount,
			dispute_id: disputeId || null,
			customer_id: customerId,
		},
	});

	return { refund: refund.rows[0], payment_status: newStatus };
}
