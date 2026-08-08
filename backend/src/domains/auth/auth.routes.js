import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import * as authController from './auth.controller.js';

const router = Router();

router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticateToken, authController.me);
router.patch('/me', authenticateToken, authController.patchMe);

export default router;
