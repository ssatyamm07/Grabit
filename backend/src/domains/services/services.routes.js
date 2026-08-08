import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as ctrl from './services.controller.js';

const router = Router();

router.get('/master', ctrl.listMasterServices);
router.post(
	'/master',
	authenticateToken,
	requireRole('super_admin', 'regional_admin', 'support', 'field_agent'),
	ctrl.createMasterService
);

router.get('/vendor/:vendorId', ctrl.listVendorServices);

router.get('/me', authenticateToken, requireRole('vendor'), ctrl.listMyServices);
router.post('/me', authenticateToken, requireRole('vendor'), ctrl.upsertMyService);

router.post(
	'/bookings',
	authenticateToken,
	requireRole('customer'),
	requireIdempotencyKey,
	ctrl.createBooking
);
router.get('/bookings/me', authenticateToken, requireRole('customer'), ctrl.listMyBookings);
router.get('/bookings/vendor', authenticateToken, requireRole('vendor'), ctrl.listVendorBookings);
router.post('/bookings/:id/transition', authenticateToken, ctrl.transitionBooking);

export default router;
