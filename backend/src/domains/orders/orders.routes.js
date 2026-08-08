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
router.get('/delivery-quote', authenticateToken, ctrl.deliveryQuote);

router.get('/:id/tracking', authenticateToken, ctrl.trackOrder);
router.get('/:id/events', authenticateToken, ctrl.listOrderEvents);
router.post('/:id/accept', authenticateToken, requireRole('vendor', 'super_admin', 'support', 'regional_admin'), ctrl.acceptOrder);
router.post('/:id/reject', authenticateToken, requireRole('vendor', 'super_admin', 'support', 'regional_admin'), ctrl.rejectOrder);
router.post('/:id/status', authenticateToken, ctrl.statusOrder);
router.post('/:id/transition', authenticateToken, ctrl.transitionOrder);
router.get('/:id', authenticateToken, ctrl.getOrder);

export default router;
