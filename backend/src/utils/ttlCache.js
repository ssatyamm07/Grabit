/**
 * Tiny in-process TTL cache — cuts repeat Google Maps billable calls.
 * Fine for a single API process; not shared across multiple replicas.
 */
const store = new Map();

export function cacheGet(key) {
	const row = store.get(key);
	if (!row) return undefined;
	if (Date.now() > row.expiresAt) {
		store.delete(key);
		return undefined;
	}
	return row.value;
}

export function cacheSet(key, value, ttlMs) {
	const ttl = Math.max(1_000, Number(ttlMs) || 60_000);
	store.set(key, { value, expiresAt: Date.now() + ttl });
	if (store.size > 2_000) {
		const first = store.keys().next().value;
		store.delete(first);
	}
}

export async function cached(key, ttlMs, loader) {
	const hit = cacheGet(key);
	if (hit !== undefined) return hit;
	const value = await loader();
	cacheSet(key, value, ttlMs);
	return value;
}

export function roundCoord(n, decimals = 4) {
	const f = 10 ** decimals;
	return Math.round(Number(n) * f) / f;
}
