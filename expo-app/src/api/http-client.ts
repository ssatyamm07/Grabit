import { config } from '@/constants/config';
import { useAuthStore } from '@/src/store/auth.store';

type Options = {
	method?: string;
	body?: unknown;
	params?: Record<string, string | number | undefined>;
	idempotencyKey?: string;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
	const base = config.apiBaseUrl.endsWith('/') ? config.apiBaseUrl : `${config.apiBaseUrl}/`;
	const url = new URL(path.replace(/^\//, ''), base);

	if (options.params) {
		for (const [key, value] of Object.entries(options.params)) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
	}

	const token = useAuthStore.getState().accessToken;
	const headers: Record<string, string> = {
		Accept: 'application/json',
	};
	if (options.body !== undefined) headers['Content-Type'] = 'application/json';
	if (token) headers.Authorization = `Bearer ${token}`;
	if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

	const res = await fetch(url.toString(), {
		method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
		headers,
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error || `Request failed (${res.status})`) as Error & {
			status?: number;
			payload?: unknown;
		};
		err.status = res.status;
		err.payload = data;
		throw err;
	}
	return data as T;
}

export function newIdempotencyKey() {
	return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
