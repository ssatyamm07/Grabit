import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import { getBalancePaise, listEntries } from './ledger.service.js';
import pool from '../../db.js';

const router = Router();

router.get('/me', authenticateToken, async (req, res) => {
	try {
		let accountRef = `customer:${req.user.id}`;
		if (req.user.role === 'vendor') {
			const v = await pool.query(`SELECT id FROM vendors WHERE user_id = $1`, [req.user.id]);
			if (v.rowCount === 0) return res.status(404).json({ error: 'Vendor not found' });
			accountRef = `vendor:${v.rows[0].id}`;
		}

		const balance_paise = await getBalancePaise(accountRef);
		const entries = await listEntries(accountRef);
		return res.json({ account_ref: accountRef, balance_paise, entries });
	} catch (err) {
		console.error('ledger me', err);
		return res.status(500).json({ error: 'Failed to load ledger' });
	}
});

router.get(
	'/account/:ref',
	authenticateToken,
	requireRole('super_admin', 'support'),
	async (req, res) => {
		try {
			const accountRef = decodeURIComponent(req.params.ref);
			const balance_paise = await getBalancePaise(accountRef);
			const entries = await listEntries(accountRef);
			return res.json({ account_ref: accountRef, balance_paise, entries });
		} catch (err) {
			console.error('ledger account', err);
			return res.status(500).json({ error: 'Failed to load ledger' });
		}
	}
);

export default router;
