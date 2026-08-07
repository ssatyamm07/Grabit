import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../../db.js';

function hashValue(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function signAccessToken(user) {
	return jwt.sign(
		{
			id: user.id,
			role: user.role,
			city_id: user.city_id,
			phone: user.phone,
		},
		process.env.JWT_SECRET,
		{ expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
	);
}

function generateOtp() {
	return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendOtp(req, res) {
	try {
		const phone = String(req.body.phone || '').replace(/\D/g, '');
		if (phone.length < 10) {
			return res.status(400).json({ error: 'Valid phone required' });
		}

		const otp = generateOtp();
		const otpHash = hashValue(otp);
		const expires = new Date(Date.now() + 10 * 60_000);

		const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
		if (existing.rowCount === 0) {
			await pool.query(
				`INSERT INTO users (phone, otp_hash, otp_expires_at, role)
				 VALUES ($1, $2, $3, 'customer')`,
				[phone, otpHash, expires]
			);
		} else {
			await pool.query(
				`UPDATE users SET otp_hash = $1, otp_expires_at = $2, updated_at = NOW()
				 WHERE phone = $3`,
				[otpHash, expires, phone]
			);
		}

		// MSG91 wiring comes later — local/dev returns OTP when enabled
		const payload = { ok: true, message: 'OTP sent' };
		if (process.env.SHOW_OTP_IN_RESPONSE === 'true') {
			payload.dev_otp = otp;
		}

		return res.json(payload);
	} catch (err) {
		console.error('sendOtp', err);
		return res.status(500).json({ error: 'Failed to send OTP' });
	}
}

export async function verifyOtp(req, res) {
	try {
		const phone = String(req.body.phone || '').replace(/\D/g, '');
		const otp = String(req.body.otp || '');
		if (!phone || !otp) {
			return res.status(400).json({ error: 'phone and otp required' });
		}

		const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
		const user = result.rows[0];
		if (!user) return res.status(404).json({ error: 'User not found' });

		if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
			return res.status(400).json({ error: 'OTP expired' });
		}

		if (user.otp_hash !== hashValue(otp)) {
			return res.status(400).json({ error: 'Invalid OTP' });
		}

		await pool.query(
			`UPDATE users
			 SET phone_verified = TRUE, otp_hash = NULL, otp_expires_at = NULL, updated_at = NOW()
			 WHERE id = $1`,
			[user.id]
		);

		const accessToken = signAccessToken(user);
		const refreshToken = crypto.randomBytes(40).toString('hex');
		const refreshHash = hashValue(refreshToken);
		const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60_000);

		await pool.query(
			`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
			 VALUES ($1, $2, $3)`,
			[user.id, refreshHash, refreshExpires]
		);

		return res.json({
			accessToken,
			refreshToken,
			user: {
				id: user.id,
				phone: user.phone,
				name: user.name,
				role: user.role,
				city_id: user.city_id,
			},
		});
	} catch (err) {
		console.error('verifyOtp', err);
		return res.status(500).json({ error: 'Failed to verify OTP' });
	}
}

export async function me(req, res) {
	try {
		const result = await pool.query(
			`SELECT id, name, phone, email, role, city_id, phone_verified, created_at
			 FROM users WHERE id = $1`,
			[req.user.id]
		);
		if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
		return res.json({ user: result.rows[0] });
	} catch (err) {
		console.error('me', err);
		return res.status(500).json({ error: 'Failed to load profile' });
	}
}
