import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import pool from '../../db.js';

const router = Router();

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

export default router;
