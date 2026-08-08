import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './analytics.controller.js';

const router = Router();
const staff = requireRole('super_admin', 'regional_admin', 'support');

router.use(authenticateToken, staff);
router.get('/pilot', ctrl.pilotMetrics);
router.get('/events', ctrl.recentEvents);

export default router;
