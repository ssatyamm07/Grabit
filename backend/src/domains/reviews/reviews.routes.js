import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './reviews.controller.js';

const router = Router();

router.get('/vendor/:vendorId', ctrl.listVendorReviews);
router.get('/me', authenticateToken, requireRole('customer'), ctrl.listMyReviews);
router.post('/', authenticateToken, requireRole('customer'), ctrl.createReview);

export default router;
