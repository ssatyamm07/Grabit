import { Router } from 'express';
import pool from '../../db.js';

const router = Router();

router.get('/master/search', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		if (!q) return res.json({ products: [] });

		const result = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images,
			        similarity(name, $1) AS score
			 FROM master_products
			 WHERE name % $1
			    OR brand ILIKE '%' || $1 || '%'
			    OR barcode = $1
			    OR name ILIKE '%' || $1 || '%'
			 ORDER BY
			   CASE WHEN barcode = $1 THEN 0 ELSE 1 END,
			   similarity(name, $1) DESC NULLS LAST,
			   name ASC
			 LIMIT 40`,
			[q]
		);
		return res.json({ products: result.rows });
	} catch (err) {
		console.error('catalog search', err);
		return res.status(500).json({ error: 'Search failed' });
	}
});

router.get('/master/categories', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT category, COUNT(*)::int AS product_count
			 FROM master_products
			 WHERE category IS NOT NULL AND category <> ''
			 GROUP BY category
			 ORDER BY category ASC`
		);
		return res.json({ categories: result.rows });
	} catch (err) {
		console.error('catalog categories', err);
		return res.status(500).json({ error: 'Failed to list categories' });
	}
});

router.get('/master/brands', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT brand, COUNT(*)::int AS product_count
			 FROM master_products
			 WHERE brand IS NOT NULL AND brand <> ''
			 GROUP BY brand
			 ORDER BY brand ASC
			 LIMIT 200`
		);
		return res.json({ brands: result.rows });
	} catch (err) {
		console.error('catalog brands', err);
		return res.status(500).json({ error: 'Failed to list brands' });
	}
});

router.get('/master/:id', async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images, created_at
			 FROM master_products WHERE id = $1`,
			[Number(req.params.id)]
		);
		if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
		return res.json({ product: result.rows[0] });
	} catch (err) {
		console.error('catalog get', err);
		return res.status(500).json({ error: 'Failed to load product' });
	}
});

export default router;
