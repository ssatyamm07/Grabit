import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './payment.controller.js';

const router = Router();

router.post('/create', authenticateToken, requireRole('customer', 'super_admin', 'support'), ctrl.createPayment);
router.post('/verify', authenticateToken, requireRole('customer', 'super_admin', 'support'), ctrl.verifyPayment);
router.post('/webhook', ctrl.paymentWebhook);
router.post(
	'/refund',
	authenticateToken,
	requireRole('super_admin', 'support', 'regional_admin'),
	ctrl.refundPayment
);
router.post(
	'/settle-commission',
	authenticateToken,
	requireRole('super_admin', 'support', 'regional_admin'),
	ctrl.settleCommission
);

export default router;
