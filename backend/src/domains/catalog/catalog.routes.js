import { Router } from 'express';
import pool from '../../db.js';

const router = Router();

/** Public master catalog search — FTS + trigram */
router.get('/master/search', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		if (!q) return res.json({ items: [] });

		const result = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images
			 FROM master_products
			 WHERE name ILIKE '%' || $1 || '%'
			    OR brand ILIKE '%' || $1 || '%'
			    OR barcode = $1
			 ORDER BY name ASC
			 LIMIT 40`,
			[q]
		);

		return res.json({ items: result.rows });
	} catch (err) {
		console.error('catalog search', err);
		return res.status(500).json({ error: 'Search failed' });
	}
});

router.get('/master/:id', async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM master_products WHERE id = $1', [req.params.id]);
		if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
		return res.json({ item: result.rows[0] });
	} catch (err) {
		console.error('catalog get', err);
		return res.status(500).json({ error: 'Failed to load product' });
	}
});

export default router;
