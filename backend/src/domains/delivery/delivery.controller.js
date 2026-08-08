import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { canTransition } from '../orders/order.state.js';
import { loadOrder } from '../orders/place-order.service.js';
import { hashOtp } from '../orders/fulfillment.js';

async function getPartnerByUserId(userId, client = pool) {
	const result = await client.query(
		`SELECT * FROM delivery_partners WHERE user_id = $1`,
		[userId]
	);
	return result.rows[0] || null;
}

export async function getMe(req, res) {
	try {
		let partner = await getPartnerByUserId(req.user.id);
		if (!partner) {
			// Auto-create partner profile for delivery role users
			const ins = await pool.query(
				`INSERT INTO delivery_partners (user_id, city_id, is_active)
				 VALUES ($1, $2, TRUE)
				 ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
				 RETURNING *`,
				[req.user.id, req.user.city_id || null]
			);
			partner = ins.rows[0];
		}
		return res.json({ partner });
	} catch (err) {
		console.error('delivery.getMe', err);
		return res.status(500).json({ error: 'Failed to load partner' });
	}
}

export async function patchLocation(req, res) {
	try {
		const lat = Number(req.body.lat);
		const lng = Number(req.body.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			return res.status(400).json({ error: 'lat and lng required' });
		}
		const partner = await getPartnerByUserId(req.user.id);
		if (!partner) {
			await pool.query(
				`INSERT INTO delivery_partners (user_id, city_id, location, is_active)
				 VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, TRUE)`,
				[req.user.id, req.user.city_id || null, lng, lat]
			);
		} else {
			await pool.query(
				`UPDATE delivery_partners
				 SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
				     updated_at = NOW()
				 WHERE user_id = $3`,
				[lng, lat, req.user.id]
			);
		}
		const updated = await getPartnerByUserId(req.user.id);
		return res.json({ partner: updated });
	} catch (err) {
		console.error('delivery.patchLocation', err);
		return res.status(500).json({ error: 'Failed to update location' });
	}
}

export async function listJobs(req, res) {
	try {
		const partner = await getPartnerByUserId(req.user.id);
		const status = req.query.status ? String(req.query.status) : null;

		// Available unassigned in same city + own assigned
		const result = await pool.query(
			`SELECT
				j.*,
				o.status AS order_status,
				o.total_paise,
				o.delivery_address_snapshot,
				o.fulfillment_mode,
				v.business_name,
				v.city_id AS vendor_city_id
			 FROM delivery_jobs j
			 JOIN orders o ON o.id = j.order_id
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.fulfillment_mode = 'partner'
			   AND (
			     (j.status = 'unassigned' AND ($1::int IS NULL OR v.city_id = $1 OR $1 IS NULL))
			     OR (j.partner_id = $2 AND j.status IN ('assigned','picked_up'))
			   )
			   AND ($3::text IS NULL OR j.status = $3)
			 ORDER BY j.created_at ASC
			 LIMIT 100`,
			[partner?.city_id || req.user.city_id || null, partner?.id || -1, status]
		);
		return res.json({ jobs: result.rows });
	} catch (err) {
		console.error('delivery.listJobs', err);
		return res.status(500).json({ error: 'Failed to list jobs' });
	}
}

export async function acceptJob(req, res) {
	const jobId = Number(req.params.id);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		let partner = await getPartnerByUserId(req.user.id, client);
		if (!partner) {
			const ins = await client.query(
				`INSERT INTO delivery_partners (user_id, city_id, is_active)
				 VALUES ($1, $2, TRUE) RETURNING *`,
				[req.user.id, req.user.city_id || null]
			);
			partner = ins.rows[0];
		}
		if (!partner.is_active) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Partner inactive' });
		}

		const jobRes = await client.query(
			`SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE`,
			[jobId]
		);
		if (jobRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Job not found' });
		}
		const job = jobRes.rows[0];
		if (job.status !== 'unassigned') {
			await client.query('ROLLBACK');
			return res.status(409).json({ error: 'Job not available' });
		}

		const updated = await client.query(
			`UPDATE delivery_jobs
			 SET status = 'assigned', partner_id = $1, assigned_at = NOW(), updated_at = NOW()
			 WHERE id = $2
			 RETURNING *`,
			[partner.id, jobId]
		);

		await enqueueOutbox(client, {
			eventType: 'delivery_job.assigned',
			aggregateType: 'delivery_job',
			aggregateId: String(jobId),
			payload: { job_id: jobId, order_id: job.order_id, partner_id: partner.id },
		});

		await client.query('COMMIT');
		return res.json({ job: updated.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('delivery.acceptJob', err);
		return res.status(500).json({ error: 'Failed to accept job' });
	} finally {
		client.release();
	}
}

export async function pickupJob(req, res) {
	const jobId = Number(req.params.id);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const partner = await getPartnerByUserId(req.user.id, client);
		if (!partner) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Partner not found' });
		}

		const jobRes = await client.query(
			`SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE`,
			[jobId]
		);
		if (jobRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Job not found' });
		}
		const job = jobRes.rows[0];
		if (job.partner_id !== partner.id || job.status !== 'assigned') {
			await client.query('ROLLBACK');
			return res.status(409).json({ error: 'Job not in assigned state for you' });
		}

		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
			job.order_id,
		]);
		const order = orderRes.rows[0];
		if (!canTransition(order.status, 'picked')) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: `Order cannot be picked from ${order.status}` });
		}

		await client.query(
			`UPDATE orders SET status = 'picked', updated_at = NOW() WHERE id = $1`,
			[order.id]
		);
		await client.query(
			`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
			 VALUES ($1, $2, 'picked', $3, '{}'::jsonb)`,
			[order.id, order.status, req.user.id]
		);

		const updated = await client.query(
			`UPDATE delivery_jobs
			 SET status = 'picked_up', picked_up_at = NOW(), updated_at = NOW()
			 WHERE id = $1 RETURNING *`,
			[jobId]
		);

		await enqueueOutbox(client, {
			eventType: 'delivery_job.picked_up',
			aggregateType: 'delivery_job',
			aggregateId: String(jobId),
			payload: { job_id: jobId, order_id: order.id },
		});

		await client.query('COMMIT');
		const full = await loadOrder(order.id);
		return res.json({ job: updated.rows[0], order: full });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('delivery.pickupJob', err);
		return res.status(500).json({ error: 'Failed to pickup' });
	} finally {
		client.release();
	}
}

export async function completeJob(req, res) {
	const jobId = Number(req.params.id);
	const otp = String(req.body.delivery_otp || req.body.otp || '');
	if (!otp) return res.status(400).json({ error: 'delivery_otp required' });

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const partner = await getPartnerByUserId(req.user.id, client);
		if (!partner) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Partner not found' });
		}

		const jobRes = await client.query(
			`SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE`,
			[jobId]
		);
		if (jobRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Job not found' });
		}
		const job = jobRes.rows[0];
		if (job.partner_id !== partner.id || job.status !== 'picked_up') {
			await client.query('ROLLBACK');
			return res.status(409).json({ error: 'Job not in picked_up state for you' });
		}

		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
			job.order_id,
		]);
		const order = orderRes.rows[0];

		if (!order.delivery_otp_hash || !order.delivery_otp_expires_at) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Delivery OTP not issued' });
		}
		if (new Date(order.delivery_otp_expires_at) < new Date()) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Delivery OTP expired' });
		}
		if (order.delivery_otp_hash !== hashOtp(otp)) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'Invalid delivery OTP' });
		}
		if (!canTransition(order.status, 'delivered')) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: `Order cannot be delivered from ${order.status}` });
		}

		await client.query(
			`UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1`,
			[order.id]
		);
		await client.query(
			`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
			 VALUES ($1, $2, 'delivered', $3, $4::jsonb)`,
			[order.id, order.status, req.user.id, JSON.stringify({ via: 'delivery_job' })]
		);

		const updated = await client.query(
			`UPDATE delivery_jobs
			 SET status = 'completed', completed_at = NOW(), updated_at = NOW()
			 WHERE id = $1 RETURNING *`,
			[jobId]
		);

		await enqueueOutbox(client, {
			eventType: 'delivery_job.completed',
			aggregateType: 'delivery_job',
			aggregateId: String(jobId),
			payload: { job_id: jobId, order_id: order.id },
		});

		await client.query('COMMIT');
		const full = await loadOrder(order.id);
		return res.json({ job: updated.rows[0], order: full });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('delivery.completeJob', err);
		return res.status(500).json({ error: 'Failed to complete delivery' });
	} finally {
		client.release();
	}
}
