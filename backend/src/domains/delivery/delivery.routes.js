import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './delivery.controller.js';

const router = Router();

router.use(authenticateToken, requireRole('delivery', 'super_admin', 'support'));

router.get('/me', ctrl.getMe);
router.patch('/me/location', ctrl.patchLocation);
router.get('/jobs', ctrl.listJobs);
router.post('/jobs/:id/accept', ctrl.acceptJob);
router.post('/jobs/:id/pickup', ctrl.pickupJob);
router.post('/jobs/:id/complete', ctrl.completeJob);

export default router;
