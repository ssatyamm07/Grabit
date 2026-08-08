import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './disputes.controller.js';

const router = Router();

router.use(authenticateToken);

router.post('/', ctrl.openDispute);
router.get('/', ctrl.listDisputes);
router.get('/:id', ctrl.getDispute);
router.post(
	'/:id/resolve',
	requireRole('super_admin', 'support', 'regional_admin'),
	ctrl.resolveDispute
);

export default router;
