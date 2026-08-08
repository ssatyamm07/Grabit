import { logger } from '../config/logger.js';

let sentryInitialized = false;

/**
 * Optional Sentry — no-op unless SENTRY_DSN is set and @sentry/node is installed.
 */
export async function initSentry() {
	const dsn = process.env.SENTRY_DSN?.trim();
	if (!dsn || sentryInitialized) return false;
	try {
		const Sentry = await import('@sentry/node');
		Sentry.init({
			dsn,
			environment: process.env.NODE_ENV || 'development',
			tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
		});
		sentryInitialized = true;
		logger.info('Sentry initialized');
		return true;
	} catch (err) {
		logger.warn(
			{ err: String(err.message || err) },
			'Sentry DSN set but @sentry/node not available — npm i @sentry/node'
		);
		return false;
	}
}

export function captureException(err, context = {}) {
	if (!sentryInitialized) return;
	import('@sentry/node')
		.then((Sentry) => {
			Sentry.withScope((scope) => {
				for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
				Sentry.captureException(err);
			});
		})
		.catch(() => {});
}
