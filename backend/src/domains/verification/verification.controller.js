import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';

function cityScope(req) {
	if (['regional_admin', 'field_agent'].includes(req.user.role)) return req.user.city_id;
	return null;
}

/** Admin/regional schedules a field-agent visit */
export async function scheduleVerification(req, res) {
	try {
		const vendorId = Number(req.body.vendor_id);
		const fieldAgentId = Number(req.body.field_agent_id);
		if (!Number.isInteger(vendorId) || !Number.isInteger(fieldAgentId)) {
			return res.status(400).json({ error: 'vendor_id and field_agent_id required' });
		}

		const agent = await pool.query(
			`SELECT id, role, city_id FROM users WHERE id = $1 AND role = 'field_agent' AND is_active = TRUE`,
			[fieldAgentId]
		);
		if (agent.rowCount === 0) return res.status(400).json({ error: 'Invalid field agent' });

		const vendor = await pool.query(`SELECT * FROM vendors WHERE id = $1`, [vendorId]);
		if (vendor.rowCount === 0) return res.status(404).json({ error: 'Vendor not found' });

		const scope = cityScope(req);
		if (scope != null && vendor.rows[0].city_id !== scope) {
			return res.status(403).json({ error: 'Outside city scope' });
		}

		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const row = await client.query(
				`INSERT INTO store_verifications (
					vendor_id, field_agent_id, status, checklist, notes, scheduled_at
				 ) VALUES ($1,$2,'scheduled',$3::jsonb,$4,$5)
				 RETURNING *`,
				[
					vendorId,
					fieldAgentId,
					JSON.stringify(req.body.checklist || { storefront: false, stock: false, hygiene: false, documents: false }),
					req.body.notes || null,
					req.body.scheduled_at || new Date(),
				]
			);
			await client.query(
				`UPDATE vendors SET verification_status = 'pending' WHERE id = $1`,
				[vendorId]
			);
			await enqueueOutbox(client, {
				eventType: 'store_verification.scheduled',
				aggregateType: 'store_verification',
				aggregateId: String(row.rows[0].id),
				payload: {
					verification_id: row.rows[0].id,
					vendor_id: vendorId,
					field_agent_id: fieldAgentId,
				},
			});
			await client.query('COMMIT');
			return res.status(201).json({ verification: row.rows[0] });
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		console.error('scheduleVerification', err);
		return res.status(500).json({ error: 'Failed to schedule verification' });
	}
}

export async function listVerifications(req, res) {
	try {
		const status = req.query.status ? String(req.query.status) : null;
		const isAgent = req.user.role === 'field_agent';
		const isStaff = ['super_admin', 'regional_admin', 'support'].includes(req.user.role);

		let result;
		if (isAgent) {
			result = await pool.query(
				`SELECT sv.*, v.business_name, v.city_id
				 FROM store_verifications sv
				 JOIN vendors v ON v.id = sv.vendor_id
				 WHERE sv.field_agent_id = $1
				   AND ($2::text IS NULL OR sv.status = $2)
				 ORDER BY sv.scheduled_at DESC NULLS LAST, sv.id DESC
				 LIMIT 100`,
				[req.user.id, status]
			);
		} else if (isStaff) {
			const scope = cityScope(req);
			result = await pool.query(
				`SELECT sv.*, v.business_name, v.city_id
				 FROM store_verifications sv
				 JOIN vendors v ON v.id = sv.vendor_id
				 WHERE ($1::int IS NULL OR v.city_id = $1)
				   AND ($2::text IS NULL OR sv.status = $2)
				 ORDER BY sv.created_at DESC
				 LIMIT 100`,
				[scope, status]
			);
		} else {
			return res.status(403).json({ error: 'Forbidden' });
		}
		return res.json({ verifications: result.rows });
	} catch (err) {
		console.error('listVerifications', err);
		return res.status(500).json({ error: 'Failed to list verifications' });
	}
}

/** Field agent starts / updates / completes verification */
export async function updateVerification(req, res) {
	const id = Number(req.params.id);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const cur = await client.query(
			`SELECT sv.*, v.city_id, v.user_id AS vendor_user_id
			 FROM store_verifications sv
			 JOIN vendors v ON v.id = sv.vendor_id
			 WHERE sv.id = $1 FOR UPDATE OF sv`,
			[id]
		);
		if (cur.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Not found' });
		}
		const row = cur.rows[0];
		const isAgent = req.user.role === 'field_agent' && row.field_agent_id === req.user.id;
		const isStaff = ['super_admin', 'regional_admin', 'support'].includes(req.user.role);
		if (!isAgent && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Forbidden' });
		}

		const nextStatus = req.body.status ? String(req.body.status) : row.status;
		if (!['scheduled', 'in_progress', 'passed', 'failed', 'cancelled'].includes(nextStatus)) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'invalid status' });
		}

		const updated = await client.query(
			`UPDATE store_verifications
			 SET status = $1,
			     checklist = COALESCE($2::jsonb, checklist),
			     notes = COALESCE($3, notes),
			     photo_urls = COALESCE($4::jsonb, photo_urls),
			     completed_at = CASE WHEN $1 IN ('passed','failed') THEN NOW() ELSE completed_at END,
			     updated_at = NOW()
			 WHERE id = $5
			 RETURNING *`,
			[
				nextStatus,
				req.body.checklist ? JSON.stringify(req.body.checklist) : null,
				req.body.notes != null ? String(req.body.notes) : null,
				req.body.photo_urls ? JSON.stringify(req.body.photo_urls) : null,
				id,
			]
		);

		if (nextStatus === 'passed') {
			await client.query(
				`UPDATE vendors
				 SET verification_status = 'verified', verified_at = NOW(), verified_by = $1, is_approved = TRUE
				 WHERE id = $2`,
				[req.user.id, row.vendor_id]
			);
		} else if (nextStatus === 'failed') {
			await client.query(
				`UPDATE vendors SET verification_status = 'rejected', verified_by = $1 WHERE id = $2`,
				[req.user.id, row.vendor_id]
			);
		}

		await enqueueOutbox(client, {
			eventType: `store_verification.${nextStatus}`,
			aggregateType: 'store_verification',
			aggregateId: String(id),
			payload: {
				verification_id: id,
				vendor_id: row.vendor_id,
				status: nextStatus,
				vendor_user_id: row.vendor_user_id,
			},
		});

		await client.query('COMMIT');
		return res.json({ verification: updated.rows[0] });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('updateVerification', err);
		return res.status(500).json({ error: 'Failed to update verification' });
	} finally {
		client.release();
	}
}
