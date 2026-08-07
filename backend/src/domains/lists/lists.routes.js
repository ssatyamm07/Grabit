import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as ctrl from './lists.controller.js';

const router = Router();

router.use(authenticateToken, requireRole('customer', 'super_admin', 'support'));

router.post('/', ctrl.createList);
router.get('/', ctrl.getLists);
router.get('/:id', ctrl.getList);
router.patch('/:id', ctrl.patchList);
router.post('/:id/archive', ctrl.archiveList);

router.post('/:id/items', ctrl.addItem);
router.patch('/:id/items/:itemId', ctrl.patchItem);
router.delete('/:id/items/:itemId', ctrl.deleteItem);

router.post('/:id/members', ctrl.addMember);
router.delete('/:id/members/:userId', ctrl.removeMember);

router.post('/:id/checkout/preview', ctrl.previewCheckout);
router.post('/:id/checkout', requireIdempotencyKey, ctrl.confirmCheckout);

export default router;
