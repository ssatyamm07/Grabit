const hits = new Map();

/**
 * @param {{ windowMs?: number, max?: number, keyFn?: (req) => string, name?: string }} opts
 */
export function rateLimit({
	windowMs = 15 * 60_000,
	max = 300,
	keyFn = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
	name = 'default',
} = {}) {
	return (req, res, next) => {
		const raw = keyFn(req);
		const key = `${name}:${raw}`;
		const now = Date.now();
		const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

		if (now > entry.resetAt) {
			entry.count = 0;
			entry.resetAt = now + windowMs;
		}

		entry.count += 1;
		hits.set(key, entry);

		res.setHeader('X-RateLimit-Limit', String(max));
		res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

		if (entry.count > max) {
			return res.status(429).json({ error: 'Too many requests' });
		}

		next();
	};
}

/** Clear in-memory buckets (tests). */
export function resetRateLimitBuckets() {
	hits.clear();
}
