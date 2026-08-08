import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../../db.js';
import { deliverLoginOtp } from '../../services/otp.js';

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

function publicUser(user) {
	return {
		id: user.id,
		phone: user.phone,
		name: user.name,
		email: user.email,
		role: user.role,
		city_id: user.city_id,
		phone_verified: user.phone_verified,
	};
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

		const delivery = await deliverLoginOtp(phone, otp);
		if (!delivery.ok) {
			console.error('sendOtp delivery failed', delivery);
			return res.status(502).json({ error: 'Failed to deliver OTP', detail: delivery.error });
		}

		const payload = {
			ok: true,
			message: delivery.mode === 'dry_run' ? 'OTP generated (dry-run)' : 'OTP sent',
			delivery: delivery.mode,
		};
		if (process.env.SHOW_OTP_IN_RESPONSE === 'true' || delivery.mode === 'dry_run') {
			if (process.env.SHOW_OTP_IN_RESPONSE === 'true') {
				payload.dev_otp = otp;
			}
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
			user: publicUser({ ...user, phone_verified: true }),
		});
	} catch (err) {
		console.error('verifyOtp', err);
		return res.status(500).json({ error: 'Failed to verify OTP' });
	}
}

export async function refresh(req, res) {
	try {
		const refreshToken = String(req.body.refreshToken || req.body.refresh_token || '');
		if (!refreshToken) {
			return res.status(400).json({ error: 'refreshToken required' });
		}

		const hash = hashValue(refreshToken);
		const stored = await pool.query(
			`SELECT rt.*, u.id AS uid, u.phone, u.name, u.email, u.role, u.city_id, u.phone_verified
			 FROM refresh_tokens rt
			 JOIN users u ON u.id = rt.user_id
			 WHERE rt.token_hash = $1`,
			[hash]
		);
		if (stored.rowCount === 0) {
			return res.status(401).json({ error: 'Invalid refresh token' });
		}

		const row = stored.rows[0];
		if (row.revoked_at || new Date(row.expires_at) < new Date()) {
			return res.status(401).json({ error: 'Refresh token expired or revoked' });
		}

		if (!row.is_active && row.is_active !== undefined) {
			// users.is_active checked below
		}

		const userCheck = await pool.query(
			`SELECT id, phone, name, email, role, city_id, phone_verified, is_active
			 FROM users WHERE id = $1`,
			[row.uid]
		);
		const user = userCheck.rows[0];
		if (!user || !user.is_active) {
			return res.status(403).json({ error: 'User inactive' });
		}

		await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);

		const accessToken = signAccessToken(user);
		const newRefresh = crypto.randomBytes(40).toString('hex');
		const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60_000);
		await pool.query(
			`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
			 VALUES ($1, $2, $3)`,
			[user.id, hashValue(newRefresh), refreshExpires]
		);

		return res.json({
			accessToken,
			refreshToken: newRefresh,
			user: publicUser(user),
		});
	} catch (err) {
		console.error('refresh', err);
		return res.status(500).json({ error: 'Failed to refresh token' });
	}
}

export async function logout(req, res) {
	try {
		const refreshToken = String(req.body.refreshToken || req.body.refresh_token || '');
		if (refreshToken) {
			await pool.query(
				`UPDATE refresh_tokens SET revoked_at = NOW()
				 WHERE token_hash = $1 AND revoked_at IS NULL`,
				[hashValue(refreshToken)]
			);
		}
		return res.json({ ok: true });
	} catch (err) {
		console.error('logout', err);
		return res.status(500).json({ error: 'Failed to logout' });
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

export async function patchMe(req, res) {
	try {
		const name = req.body.name != null ? String(req.body.name).trim() : undefined;
		const email = req.body.email != null ? String(req.body.email).trim() || null : undefined;
		const cityId = req.body.city_id != null ? Number(req.body.city_id) : undefined;

		const fields = [];
		const values = [];
		let i = 1;

		if (name !== undefined) {
			fields.push(`name = $${i++}`);
			values.push(name || null);
		}
		if (email !== undefined) {
			fields.push(`email = $${i++}`);
			values.push(email);
		}
		if (cityId !== undefined) {
			if (!Number.isInteger(cityId) || cityId < 1) {
				return res.status(400).json({ error: 'invalid city_id' });
			}
			fields.push(`city_id = $${i++}`);
			values.push(cityId);
		}

		if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

		fields.push('updated_at = NOW()');
		values.push(req.user.id);

		const result = await pool.query(
			`UPDATE users SET ${fields.join(', ')}
			 WHERE id = $${i}
			 RETURNING id, name, phone, email, role, city_id, phone_verified, created_at`,
			values
		);
		return res.json({ user: result.rows[0] });
	} catch (err) {
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Email already in use' });
		}
		console.error('patchMe', err);
		return res.status(500).json({ error: 'Failed to update profile' });
	}
}
