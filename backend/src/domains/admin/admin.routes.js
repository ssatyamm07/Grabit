import { Router } from 'express';
import { authenticateToken, requireRole, requireCityScope } from '../../middleware/auth.js';
import * as ctrl from './admin.controller.js';

const router = Router();

const staff = requireRole('super_admin', 'regional_admin', 'support', 'field_agent');

router.use(authenticateToken, staff, requireCityScope);

router.get('/stats', ctrl.stats);

router.get('/vendors', ctrl.listVendors);
router.post('/vendors/:id/approve', ctrl.approveVendor);
router.post('/vendors/:id/reject', ctrl.rejectVendor);

router.get('/users', ctrl.listUsers);
router.post('/users/:id/deactivate', ctrl.deactivateUser);

router.post('/catalog/master', ctrl.createMasterProduct);
router.patch('/catalog/master/:id', ctrl.updateMasterProduct);

router.get('/proposals', ctrl.listProposals);
router.post('/proposals/:id/approve', ctrl.approveProposal);
router.post('/proposals/:id/reject', ctrl.rejectProposal);

router.get('/orders', ctrl.listOrders);
router.post('/orders/:id/transition', ctrl.forceTransition);

router.get('/settings', ctrl.getSettings);
router.put('/settings/:key', ctrl.putSetting);
router.put('/info-pages/:slug', ctrl.upsertInfoPage);

export default router;
