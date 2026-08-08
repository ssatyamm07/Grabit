import Redis from 'ioredis';
import { logger } from '../config/logger.js';

let client = null;
let available = null;

export function redisUrl() {
	return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

export function redisEnabled() {
	return process.env.REDIS_DISABLED !== 'true';
}

/**
 * Lazy shared Redis connection. Returns null if disabled or unreachable (after probe).
 */
export function getRedis() {
	if (!redisEnabled()) return null;
	if (client) return client;
	client = new Redis(redisUrl(), {
		maxRetriesPerRequest: null,
		enableReadyCheck: true,
		lazyConnect: true,
		connectTimeout: 1500,
		retryStrategy: () => null,
	});
	client.on('error', (err) => {
		logger.warn({ err: String(err.message || err) }, 'redis error');
	});
	return client;
}

export async function pingRedis() {
	if (!redisEnabled()) {
		available = false;
		return { ok: false, reason: 'disabled' };
	}
	try {
		const r = getRedis();
		if (r.status !== 'ready') await r.connect();
		const pong = await r.ping();
		available = pong === 'PONG';
		return { ok: available };
	} catch (err) {
		available = false;
		return { ok: false, error: String(err.message || err) };
	}
}

export function isRedisAvailable() {
	return available === true;
}
