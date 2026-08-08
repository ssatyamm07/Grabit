import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import * as ctrl from './vendors.controller.js';

const router = Router();

router.post('/me/apply', authenticateToken, ctrl.apply);
router.get('/me', authenticateToken, requireRole('vendor'), ctrl.getMe);
router.patch('/me', authenticateToken, requireRole('vendor'), ctrl.patchMe);

router.get('/me/listings', authenticateToken, requireRole('vendor'), ctrl.listMyListings);
router.post('/me/listings', authenticateToken, requireRole('vendor'), ctrl.createListing);
router.patch('/me/listings/:id', authenticateToken, requireRole('vendor'), ctrl.updateListing);
router.patch('/me/inventory/:id', authenticateToken, requireRole('vendor'), ctrl.updateInventory);

router.post('/me/proposals', authenticateToken, requireRole('vendor'), ctrl.createProposal);
router.get('/me/proposals', authenticateToken, requireRole('vendor'), ctrl.listMyProposals);

router.get('/', ctrl.listOpenVendors);
router.get('/:vendorId/storefront', ctrl.listVendorStorefront);

export default router;
