import pool from '../db.js';

/**
 * Replay cached response for (user, key, route) or continue and let handler save.
 */
export function requireIdempotencyKey(req, res, next) {
	const key = req.headers['idempotency-key'];
	if (!key || typeof key !== 'string' || key.length < 8 || key.length > 128) {
		return res.status(400).json({
			error: 'Idempotency-Key header required (8–128 chars)',
		});
	}
	req.idempotencyKey = key;
	next();
}

export async function withIdempotency(req, res, route, handler) {
	const userId = req.user.id;
	const key = req.idempotencyKey;

	const existing = await pool.query(
		`SELECT response_status, response_body
		 FROM idempotency_keys
		 WHERE user_id = $1 AND key = $2 AND route = $3`,
		[userId, key, route]
	);

	if (existing.rowCount > 0 && existing.rows[0].response_status) {
		return res.status(existing.rows[0].response_status).json(existing.rows[0].response_body);
	}

	const result = await handler();
	const status = result.status || 200;
	const body = result.body;

	await pool.query(
		`INSERT INTO idempotency_keys (user_id, key, route, response_status, response_body)
		 VALUES ($1, $2, $3, $4, $5::jsonb)
		 ON CONFLICT (user_id, key, route)
		 DO UPDATE SET response_status = EXCLUDED.response_status,
		               response_body = EXCLUDED.response_body`,
		[userId, key, route, status, JSON.stringify(body)]
	);

	return res.status(status).json(body);
}
