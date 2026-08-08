import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import * as authController from './auth.controller.js';

const router = Router();

const otpSendLimit = rateLimit({
	windowMs: Number(process.env.OTP_RATE_WINDOW_MS || 15 * 60_000),
	max: Number(process.env.OTP_RATE_MAX || 5),
	name: 'otp-send',
	keyFn: (req) => {
		const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
		const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
		return phone ? `phone:${phone}` : `ip:${ip}`;
	},
});

const otpVerifyLimit = rateLimit({
	windowMs: Number(process.env.OTP_VERIFY_WINDOW_MS || 15 * 60_000),
	max: Number(process.env.OTP_VERIFY_MAX || 20),
	name: 'otp-verify',
	keyFn: (req) => {
		const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
		return phone || req.ip || 'unknown';
	},
});

router.post('/send-otp', otpSendLimit, authController.sendOtp);
router.post('/verify-otp', otpVerifyLimit, authController.verifyOtp);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticateToken, authController.me);
router.patch('/me', authenticateToken, authController.patchMe);

export default router;
