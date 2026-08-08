import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { getVendorByUserId } from '../vendors/vendor.helpers.js';

const BOOKING_TRANSITIONS = {
	requested: ['accepted', 'rejected', 'cancelled'],
	accepted: ['in_progress', 'cancelled', 'no_show'],
	in_progress: ['completed', 'cancelled'],
	rejected: [],
	completed: [],
	cancelled: [],
	no_show: [],
};

export async function listMasterServices(_req, res) {
	try {
		const result = await pool.query(
			`SELECT * FROM master_services WHERE is_active = TRUE ORDER BY category, name`
		);
		return res.json({ services: result.rows });
	} catch (err) {
		console.error('listMasterServices', err);
		return res.status(500).json({ error: 'Failed to list services' });
	}
}

export async function createMasterService(req, res) {
	try {
		const name = String(req.body.name || '').trim();
		if (!name) return res.status(400).json({ error: 'name required' });
		const result = await pool.query(
			`INSERT INTO master_services (name, category, description, unit_label, images)
			 VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
			[
				name,
				req.body.category || null,
				req.body.description || null,
				req.body.unit_label || 'visit',
				JSON.stringify(req.body.images || []),
			]
		);
		return res.status(201).json({ service: result.rows[0] });
	} catch (err) {
		console.error('createMasterService', err);
		return res.status(500).json({ error: 'Failed to create service' });
	}
}

export async function listVendorServices(req, res) {
	try {
		const vendorId = Number(req.params.vendorId || req.query.vendor_id);
		if (!Number.isInteger(vendorId)) {
			return res.status(400).json({ error: 'vendor_id required' });
		}
		const result = await pool.query(
			`SELECT vs.*, v.business_name
			 FROM vendor_services vs
			 JOIN vendors v ON v.id = vs.vendor_id
			 WHERE vs.vendor_id = $1 AND vs.is_active = TRUE AND v.is_approved = TRUE
			 ORDER BY vs.title`,
			[vendorId]
		);
		return res.json({ services: result.rows });
	} catch (err) {
		console.error('listVendorServices', err);
		return res.status(500).json({ error: 'Failed to list vendor services' });
	}
}

export async function upsertMyService(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
		if (!vendor.is_approved) return res.status(403).json({ error: 'Vendor pending approval' });

		const title = String(req.body.title || '').trim();
		const pricePaise = Number(req.body.price_paise);
		if (!title || !Number.isInteger(pricePaise) || pricePaise < 0) {
			return res.status(400).json({ error: 'title and price_paise required' });
		}

		const result = await pool.query(
			`INSERT INTO vendor_services (
				vendor_id, master_service_id, title, description, price_paise, duration_minutes, is_active
			 ) VALUES ($1,$2,$3,$4,$5,$6,TRUE)
			 ON CONFLICT (vendor_id, title)
			 DO UPDATE SET
			   description = EXCLUDED.description,
			   price_paise = EXCLUDED.price_paise,
			   duration_minutes = EXCLUDED.duration_minutes,
			   master_service_id = EXCLUDED.master_service_id,
			   is_active = TRUE
			 RETURNING *`,
			[
				vendor.id,
				req.body.master_service_id || null,
				title,
				req.body.description || null,
				pricePaise,
				Number(req.body.duration_minutes) || 60,
			]
		);
		return res.status(201).json({ service: result.rows[0] });
	} catch (err) {
		console.error('upsertMyService', err);
		return res.status(500).json({ error: 'Failed to save service' });
	}
}

export async function listMyServices(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
		const result = await pool.query(
			`SELECT * FROM vendor_services WHERE vendor_id = $1 ORDER BY created_at DESC`,
			[vendor.id]
		);
		return res.json({ services: result.rows });
	} catch (err) {
		console.error('listMyServices', err);
		return res.status(500).json({ error: 'Failed to list services' });
	}
}

export async function createBooking(req, res) {
	const vendorServiceId = Number(req.body.vendor_service_id);
	const scheduledStart = req.body.scheduled_start;
	if (!Number.isInteger(vendorServiceId) || !scheduledStart) {
		return res.status(400).json({ error: 'vendor_service_id and scheduled_start required' });
	}

	const idempotencyKey = req.idempotencyKey || req.headers['idempotency-key'] || null;
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		if (idempotencyKey) {
			const existing = await client.query(
				`SELECT * FROM service_bookings WHERE customer_id = $1 AND idempotency_key = $2`,
				[req.user.id, idempotencyKey]
			);
			if (existing.rowCount > 0) {
				await client.query('COMMIT');
				return res.json({ booking: existing.rows[0], replayed: true });
			}
		}

		const svc = await client.query(
			`SELECT vs.*, v.is_approved, v.is_open, v.user_id AS vendor_user_id
			 FROM vendor_services vs
			 JOIN vendors v ON v.id = vs.vendor_id
			 WHERE vs.id = $1 AND vs.is_active = TRUE FOR UPDATE OF vs`,
			[vendorServiceId]
		);
		if (svc.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Service not found' });
		}
		const s = svc.rows[0];
		if (!s.is_approved || !s.is_open) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Vendor unavailable' });
		}

		const start = new Date(scheduledStart);
		if (Number.isNaN(start.getTime())) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'invalid scheduled_start' });
		}
		const end = new Date(start.getTime() + s.duration_minutes * 60_000);

		const booking = await client.query(
			`INSERT INTO service_bookings (
				customer_id, vendor_id, vendor_service_id, status,
				scheduled_start, scheduled_end, address_snapshot, price_paise, notes, idempotency_key
			 ) VALUES ($1,$2,$3,'requested',$4,$5,$6::jsonb,$7,$8,$9)
			 RETURNING *`,
			[
				req.user.id,
				s.vendor_id,
				vendorServiceId,
				start.toISOString(),
				end.toISOString(),
				JSON.stringify(req.body.address || req.body.address_snapshot || null),
				s.price_paise,
				req.body.notes || null,
				idempotencyKey,
			]
		);

		await enqueueOutbox(client, {
			eventType: 'service_booking.requested',
			aggregateType: 'service_booking',
			aggregateId: String(booking.rows[0].id),
			payload: {
				booking_id: booking.rows[0].id,
				customer_id: req.user.id,
				vendor_id: s.vendor_id,
				vendor_user_id: s.vendor_user_id,
			},
		});

		await client.query('COMMIT');
		return res.status(201).json({ booking: booking.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Duplicate idempotency key' });
		}
		console.error('createBooking', err);
		return res.status(500).json({ error: 'Failed to create booking' });
	} finally {
		client.release();
	}
}

export async function listMyBookings(req, res) {
	try {
		const result = await pool.query(
			`SELECT b.*, vs.title AS service_title, v.business_name
			 FROM service_bookings b
			 JOIN vendor_services vs ON vs.id = b.vendor_service_id
			 JOIN vendors v ON v.id = b.vendor_id
			 WHERE b.customer_id = $1
			 ORDER BY b.scheduled_start DESC
			 LIMIT 50`,
			[req.user.id]
		);
		return res.json({ bookings: result.rows });
	} catch (err) {
		console.error('listMyBookings', err);
		return res.status(500).json({ error: 'Failed to list bookings' });
	}
}

export async function listVendorBookings(req, res) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
		const result = await pool.query(
			`SELECT b.*, vs.title AS service_title, u.phone AS customer_phone, u.name AS customer_name
			 FROM service_bookings b
			 JOIN vendor_services vs ON vs.id = b.vendor_service_id
			 JOIN users u ON u.id = b.customer_id
			 WHERE b.vendor_id = $1
			 ORDER BY b.scheduled_start DESC
			 LIMIT 50`,
			[vendor.id]
		);
		return res.json({ bookings: result.rows });
	} catch (err) {
		console.error('listVendorBookings', err);
		return res.status(500).json({ error: 'Failed to list bookings' });
	}
}

export async function transitionBooking(req, res) {
	const id = Number(req.params.id);
	const toStatus = String(req.body.to_status || req.body.status || '');
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const cur = await client.query(
			`SELECT b.*, v.user_id AS vendor_user_id
			 FROM service_bookings b
			 JOIN vendors v ON v.id = b.vendor_id
			 WHERE b.id = $1 FOR UPDATE OF b`,
			[id]
		);
		if (cur.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Not found' });
		}
		const b = cur.rows[0];
		const isCustomer = b.customer_id === req.user.id;
		const isVendor = b.vendor_user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin'].includes(req.user.role);

		const allowed = BOOKING_TRANSITIONS[b.status] || [];
		if (!allowed.includes(toStatus)) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: `Cannot transition ${b.status} → ${toStatus}` });
		}

		if (['accepted', 'rejected', 'in_progress', 'completed', 'no_show'].includes(toStatus)) {
			if (!isVendor && !isStaff) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Vendor only' });
			}
		}
		if (toStatus === 'cancelled' && !isCustomer && !isVendor && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Not allowed' });
		}

		const updated = await client.query(
			`UPDATE service_bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
			[toStatus, id]
		);

		await enqueueOutbox(client, {
			eventType: `service_booking.${toStatus}`,
			aggregateType: 'service_booking',
			aggregateId: String(id),
			payload: {
				booking_id: id,
				from: b.status,
				to: toStatus,
				customer_id: b.customer_id,
				vendor_user_id: b.vendor_user_id,
			},
		});

		await client.query('COMMIT');
		return res.json({ booking: updated.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('transitionBooking', err);
		return res.status(500).json({ error: 'Failed to update booking' });
	} finally {
		client.release();
	}
}
