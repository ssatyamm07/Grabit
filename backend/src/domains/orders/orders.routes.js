import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import { requireIdempotencyKey, withIdempotency } from '../../middleware/idempotency.js';
import * as ctrl from './orders.controller.js';

const router = Router();

router.post(
	'/',
	authenticateToken,
	requireRole('customer'),
	requireIdempotencyKey,
	async (req, res) => {
		await withIdempotency(req, res, 'POST /api/orders', () => ctrl.placeOrder(req));
	}
);

router.get('/me', authenticateToken, requireRole('customer'), ctrl.listMyOrders);
router.get('/vendor', authenticateToken, requireRole('vendor'), ctrl.listVendorOrders);
router.get('/:id', authenticateToken, ctrl.getOrder);
router.post('/:id/transition', authenticateToken, ctrl.transitionOrder);

export default router;
