import { Router } from 'express';
import pool from '../../db.js';

const router = Router();

router.get('/app-settings', async (_req, res) => {
	try {
		const result = await pool.query(`SELECT key, value FROM app_settings ORDER BY key`);
		const map = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
		return res.json({ settings: map });
	} catch (err) {
		console.error('settings.app', err);
		return res.status(500).json({ error: 'Failed to load settings' });
	}
});

router.get('/info-pages', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT slug, title, updated_at FROM info_pages ORDER BY slug`
		);
		return res.json({ pages: result.rows });
	} catch (err) {
		console.error('settings.infoPages', err);
		return res.status(500).json({ error: 'Failed to list pages' });
	}
});

router.get('/info-pages/:slug', async (req, res) => {
	try {
		const result = await pool.query(`SELECT * FROM info_pages WHERE slug = $1`, [
			String(req.params.slug),
		]);
		if (result.rowCount === 0) return res.status(404).json({ error: 'Page not found' });
		return res.json({ page: result.rows[0] });
	} catch (err) {
		console.error('settings.infoPage', err);
		return res.status(500).json({ error: 'Failed to load page' });
	}
});

export default router;
