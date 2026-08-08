import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

import pool from './db.js';
import { rateLimit } from './middleware/rateLimit.js';
import authRoutes from './domains/auth/auth.routes.js';
import catalogRoutes from './domains/catalog/catalog.routes.js';
import geoRoutes from './domains/geo/geo.routes.js';
import vendorsRoutes from './domains/vendors/vendors.routes.js';
import ordersRoutes from './domains/orders/orders.routes.js';
import ledgerRoutes from './domains/ledger/ledger.routes.js';
import listsRoutes from './domains/lists/lists.routes.js';
import addressesRoutes from './domains/addresses/addresses.routes.js';
import deliveryRoutes from './domains/delivery/delivery.routes.js';
import adminRoutes from './domains/admin/admin.routes.js';
import devicesRoutes from './domains/devices/devices.routes.js';
import settingsRoutes from './domains/settings/settings.routes.js';
import paymentRoutes from './domains/payment/payment.routes.js';
import disputesRoutes from './domains/disputes/disputes.routes.js';
import verificationRoutes from './domains/verification/verification.routes.js';
import servicesRoutes from './domains/services/services.routes.js';
import reviewsRoutes from './domains/reviews/reviews.routes.js';
import searchRoutes from './domains/search/search.routes.js';
import analyticsRoutes from './domains/analytics/analytics.routes.js';
import { pingRedis } from './config/redis.js';

dotenv.config();

export function createApp() {
	const app = express();

	const DEFAULT_CORS = [
		'http://localhost:8081',
		'http://localhost:8082',
		'http://localhost:5173',
		'http://127.0.0.1:8081',
		'http://127.0.0.1:8082',
	];

	function getCorsOrigins() {
		const fromEnv = process.env.CORS_ORIGINS?.split(',')
			.map((o) => o.trim())
			.filter(Boolean);
		return fromEnv?.length ? [...new Set([...DEFAULT_CORS, ...fromEnv])] : DEFAULT_CORS;
	}

	const corsOptions = {
		origin: getCorsOrigins(),
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
	};

	app.use(helmet());
	app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
	app.use(cors(corsOptions));
	app.options('*', cors(corsOptions));
	app.use(
		rateLimit({
			windowMs: 15 * 60_000,
			max: Number.parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
		})
	);
	app.use(cookieParser());
	app.use(express.json({ limit: '2mb' }));

	app.use((req, res, next) => {
		req.requestId = req.headers['x-request-id'] || randomUUID();
		res.setHeader('X-Request-Id', req.requestId);
		next();
	});

	app.get('/api/health', async (_req, res) => {
		const started = Date.now();
		const body = {
			status: 'OK',
			service: 'grabit-api',
			env: process.env.NODE_ENV || 'development',
			brand: { primary: 'blue', accent: 'yellow', success: 'green' },
			checks: {},
		};

		try {
			await pool.query('SELECT 1 AS ok');
			body.checks.database = { ok: true };
		} catch (err) {
			body.status = 'DEGRADED';
			body.checks.database = { ok: false, error: String(err.message || err) };
		}

		try {
			const unpublished = await pool.query(
				`SELECT COUNT(*)::int AS n FROM outbox WHERE published_at IS NULL`
			);
			body.checks.outbox_backlog = { ok: true, unpublished: unpublished.rows[0].n };
		} catch (err) {
			body.checks.outbox_backlog = { ok: false, error: String(err.message || err) };
		}

		body.checks.redis = await pingRedis();

		body.latency_ms = Date.now() - started;
		const code = body.status === 'OK' ? 200 : 503;
		return res.status(code).json(body);
	});

	app.use('/api/auth', authRoutes);
	app.use('/api/catalog', catalogRoutes);
	app.use('/api/geo', geoRoutes);
	app.use('/api/vendors', vendorsRoutes);
	app.use('/api/orders', ordersRoutes);
	app.use('/api/ledger', ledgerRoutes);
	app.use('/api/lists', listsRoutes);
	app.use('/api/addresses', addressesRoutes);
	app.use('/api/delivery', deliveryRoutes);
	app.use('/api/admin', adminRoutes);
	app.use('/api/devices', devicesRoutes);
	app.use('/api/payment', paymentRoutes);
	app.use('/api/disputes', disputesRoutes);
	app.use('/api/verification', verificationRoutes);
	app.use('/api/services', servicesRoutes);
	app.use('/api/reviews', reviewsRoutes);
	app.use('/api/search', searchRoutes);
	app.use('/api/analytics', analyticsRoutes);
	app.use('/api', settingsRoutes);

	app.use((err, req, res, _next) => {
		console.error(err);
		res.status(500).json({ error: 'Something went wrong', requestId: req.requestId });
	});

	app.use('/api', (req, res) => {
		res.status(404).json({ error: 'API route not found', path: req.path, method: req.method });
	});

	return app;
}
