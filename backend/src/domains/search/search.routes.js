import { Router } from 'express';
import * as ctrl from './search.controller.js';

const router = Router();
router.get('/', ctrl.unifiedSearch);
export default router;
