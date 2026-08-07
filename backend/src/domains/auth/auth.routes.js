import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import * as authController from './auth.controller.js';

const router = Router();

router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.get('/me', authenticateToken, authController.me);

export default router;
