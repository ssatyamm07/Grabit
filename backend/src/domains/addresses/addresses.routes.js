import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import * as ctrl from './addresses.controller.js';

const router = Router();

router.use(authenticateToken);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.put('/:id', ctrl.update);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
