import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { writeAuditLog } from '../../services/audit.js';

async function assertDeliveredOrder(client, orderId, customerId) {
	const o = await client.query(
		`SELECT o.*, v.user_id AS vendor_user_id
		 FROM orders o JOIN vendors v ON v.id = o.vendor_id
		 WHERE o.id = $1 FOR UPDATE OF o`,
		[orderId]
	);
	if (o.rowCount === 0) return { error: 'Order not found', status: 404 };
	if (o.rows[0].customer_id !== customerId) return { error: 'Forbidden', status: 403 };
	if (o.rows[0].status !== 'delivered') {
		return { error: 'Can only review delivered orders', status: 400 };
	}
	return { order: o.rows[0] };
}

async function assertCompletedBooking(client, bookingId, customerId) {
	const b = await client.query(
		`SELECT * FROM service_bookings WHERE id = $1 FOR UPDATE`,
		[bookingId]
	);
	if (b.rowCount === 0) return { error: 'Booking not found', status: 404 };
	if (b.rows[0].customer_id !== customerId) return { error: 'Forbidden', status: 403 };
	if (b.rows[0].status !== 'completed') {
		return { error: 'Can only review completed bookings', status: 400 };
	}
	return { booking: b.rows[0] };
}

export async function createReview(req, res) {
	const rating = Number(req.body.rating);
	const body = req.body.body != null ? String(req.body.body).slice(0, 2000) : null;
	const orderId = req.body.order_id != null ? Number(req.body.order_id) : null;
	const bookingId = req.body.booking_id != null ? Number(req.body.booking_id) : null;

	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		return res.status(400).json({ error: 'rating 1–5 required' });
	}
	if (!orderId && !bookingId) {
		return res.status(400).json({ error: 'order_id or booking_id required' });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		let vendorId;
		if (orderId) {
			const check = await assertDeliveredOrder(client, orderId, req.user.id);
			if (check.error) {
				await client.query('ROLLBACK');
				return res.status(check.status).json({ error: check.error });
			}
			vendorId = check.order.vendor_id;
		} else {
			const check = await assertCompletedBooking(client, bookingId, req.user.id);
			if (check.error) {
				await client.query('ROLLBACK');
				return res.status(check.status).json({ error: check.error });
			}
			vendorId = check.booking.vendor_id;
		}

		const review = await client.query(
			`INSERT INTO reviews (customer_id, vendor_id, order_id, booking_id, rating, body)
			 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
			[req.user.id, vendorId, orderId, bookingId, rating, body]
		);

		await enqueueOutbox(client, {
			eventType: 'review.created',
			aggregateType: 'review',
			aggregateId: String(review.rows[0].id),
			payload: {
				review_id: review.rows[0].id,
				vendor_id: vendorId,
				customer_id: req.user.id,
				order_id: orderId,
				booking_id: bookingId,
				rating,
			},
		});
		await writeAuditLog(client, {
			actorUserId: req.user.id,
			action: 'review.created',
			entityType: 'review',
			entityId: review.rows[0].id,
			meta: { vendor_id: vendorId, rating },
			ip: req.ip,
		});
		await client.query('COMMIT');
		return res.status(201).json({ review: review.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Already reviewed' });
		}
		console.error('createReview', err);
		return res.status(500).json({ error: 'Failed to create review' });
	} finally {
		client.release();
	}
}

export async function listVendorReviews(req, res) {
	try {
		const vendorId = Number(req.params.vendorId);
		const result = await pool.query(
			`SELECT r.id, r.rating, r.body, r.created_at, r.order_id, r.booking_id,
			        u.name AS customer_name
			 FROM reviews r
			 JOIN users u ON u.id = r.customer_id
			 WHERE r.vendor_id = $1
			 ORDER BY r.created_at DESC
			 LIMIT 50`,
			[vendorId]
		);
		const agg = await pool.query(
			`SELECT COUNT(*)::int AS count, ROUND(AVG(rating)::numeric, 2) AS avg_rating
			 FROM reviews WHERE vendor_id = $1`,
			[vendorId]
		);
		return res.json({
			reviews: result.rows,
			summary: {
				count: agg.rows[0].count,
				avg_rating: agg.rows[0].avg_rating != null ? Number(agg.rows[0].avg_rating) : null,
			},
		});
	} catch (err) {
		console.error('listVendorReviews', err);
		return res.status(500).json({ error: 'Failed to list reviews' });
	}
}

export async function listMyReviews(req, res) {
	try {
		const result = await pool.query(
			`SELECT r.*, v.business_name
			 FROM reviews r
			 JOIN vendors v ON v.id = r.vendor_id
			 WHERE r.customer_id = $1
			 ORDER BY r.created_at DESC
			 LIMIT 50`,
			[req.user.id]
		);
		return res.json({ reviews: result.rows });
	} catch (err) {
		console.error('listMyReviews', err);
		return res.status(500).json({ error: 'Failed to list reviews' });
	}
}
