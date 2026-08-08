import { Router } from 'express';
import { authenticateToken, requireRole, requireCityScope } from '../../middleware/auth.js';
import * as ctrl from './verification.controller.js';

const router = Router();

router.use(authenticateToken);

router.post(
	'/schedule',
	requireRole('super_admin', 'regional_admin', 'support', 'field_agent'),
	requireCityScope,
	ctrl.scheduleVerification
);
router.get(
	'/',
	requireRole('super_admin', 'regional_admin', 'support', 'field_agent'),
	ctrl.listVerifications
);
router.patch(
	'/:id',
	requireRole('super_admin', 'regional_admin', 'support', 'field_agent'),
	ctrl.updateVerification
);

export default router;
