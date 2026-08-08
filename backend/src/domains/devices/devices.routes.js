import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import pool from '../../db.js';

const router = Router();

async function sendExpoPush(messages) {
	const res = await fetch('https://exp.host/--/api/v2/push/send', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(messages),
	});
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data };
}

router.post('/register', authenticateToken, async (req, res) => {
	try {
		const token = String(req.body.expo_push_token || '').trim();
		const platform = req.body.platform ? String(req.body.platform) : null;
		if (!token) return res.status(400).json({ error: 'expo_push_token required' });

		const result = await pool.query(
			`INSERT INTO devices (user_id, expo_push_token, platform)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, expo_push_token)
			 DO UPDATE SET platform = EXCLUDED.platform
			 RETURNING *`,
			[req.user.id, token, platform]
		);
		return res.status(201).json({ device: result.rows[0] });
	} catch (err) {
		console.error('devices.register', err);
		return res.status(500).json({ error: 'Failed to register device' });
	}
});

router.delete('/register', authenticateToken, async (req, res) => {
	try {
		const token = String(req.body.expo_push_token || req.query.expo_push_token || '').trim();
		if (!token) return res.status(400).json({ error: 'expo_push_token required' });
		await pool.query(`DELETE FROM devices WHERE user_id = $1 AND expo_push_token = $2`, [
			req.user.id,
			token,
		]);
		return res.json({ ok: true });
	} catch (err) {
		console.error('devices.unregister', err);
		return res.status(500).json({ error: 'Failed to unregister device' });
	}
});

/**
 * Send push to a user (staff) or self (any auth).
 * body: { user_id?, title, body, data? }
 */
router.post(
	'/push',
	authenticateToken,
	async (req, res) => {
		try {
			const title = String(req.body.title || '').trim();
			const body = String(req.body.body || '').trim();
			if (!title || !body) {
				return res.status(400).json({ error: 'title and body required' });
			}

			let targetUserId = req.user.id;
			if (req.body.user_id != null) {
				const staff = ['super_admin', 'support', 'regional_admin'].includes(req.user.role);
				if (!staff) return res.status(403).json({ error: 'Staff only to push other users' });
				targetUserId = Number(req.body.user_id);
			}

			const devices = await pool.query(
				`SELECT expo_push_token FROM devices WHERE user_id = $1`,
				[targetUserId]
			);
			if (devices.rowCount === 0) {
				return res.status(404).json({ error: 'No devices registered for user' });
			}

			const dryRun = process.env.PUSH_DRY_RUN === 'true' || !process.env.EXPO_ACCESS_TOKEN;
			const messages = devices.rows.map((d) => ({
				to: d.expo_push_token,
				sound: 'default',
				title,
				body,
				data: req.body.data || {},
			}));

			if (dryRun || process.env.NODE_ENV === 'test') {
				return res.json({
					ok: true,
					dry_run: true,
					sent: messages.length,
					tokens: messages.map((m) => m.to),
				});
			}

			const result = await sendExpoPush(messages);
			return res.json({ ok: result.ok, sent: messages.length, expo: result.data });
		} catch (err) {
			console.error('devices.push', err);
			return res.status(500).json({ error: 'Failed to send push' });
		}
	}
);

export default router;
