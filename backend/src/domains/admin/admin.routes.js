import { Router } from 'express';
import { authenticateToken, requireRole, requireCityScope } from '../../middleware/auth.js';
import pool from '../../db.js';
import { uploadImages } from '../../middleware/upload.js';
import * as ctrl from './admin.controller.js';

const router = Router();

const staff = requireRole('super_admin', 'regional_admin', 'support', 'field_agent');

router.use(authenticateToken, staff, requireCityScope);

router.get('/stats', ctrl.stats);

router.get('/vendors', ctrl.listVendors);
router.post('/vendors/:id/approve', ctrl.approveVendor);
router.post('/vendors/:id/reject', ctrl.rejectVendor);

router.get('/users', ctrl.listUsers);
router.post('/users/:id/deactivate', ctrl.deactivateUser);

router.post('/catalog/master', ctrl.createMasterProduct);
router.patch('/catalog/master/:id', ctrl.updateMasterProduct);
router.post(
	'/catalog/master/:id/images',
	(req, res, next) => {
		uploadImages.array('images', 8)(req, res, (err) => {
			if (err) return res.status(400).json({ error: err.message });
			next();
		});
	},
	ctrl.uploadMasterProductImages
);
router.delete('/catalog/master/:id/images', ctrl.deleteMasterProductImage);

router.get('/catalog/categories', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT category, COUNT(*)::int AS product_count
			 FROM master_products
			 WHERE category IS NOT NULL AND category <> ''
			 GROUP BY category ORDER BY category`
		);
		return res.json({ categories: result.rows });
	} catch (err) {
		return res.status(500).json({ error: 'Failed to list categories' });
	}
});
router.get('/catalog/brands', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT brand, COUNT(*)::int AS product_count
			 FROM master_products
			 WHERE brand IS NOT NULL AND brand <> ''
			 GROUP BY brand ORDER BY brand LIMIT 200`
		);
		return res.json({ brands: result.rows });
	} catch (err) {
		return res.status(500).json({ error: 'Failed to list brands' });
	}
});
router.get('/catalog/master', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		const result = await pool.query(
			`SELECT id, name, brand, barcode, category, unit_label, images
			 FROM master_products
			 WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR brand ILIKE '%' || $1 || '%')
			 ORDER BY id DESC LIMIT 100`,
			[q]
		);
		return res.json({ products: result.rows });
	} catch (err) {
		return res.status(500).json({ error: 'Failed to list products' });
	}
});

router.get('/proposals', ctrl.listProposals);
router.post('/proposals/:id/approve', ctrl.approveProposal);
router.post('/proposals/:id/reject', ctrl.rejectProposal);

router.get('/orders', ctrl.listOrders);
router.post('/orders/:id/transition', ctrl.forceTransition);

router.get('/settings', ctrl.getSettings);
router.put('/settings/:key', ctrl.putSetting);
router.put('/info-pages/:slug', ctrl.upsertInfoPage);

export default router;
