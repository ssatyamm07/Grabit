import dotenv from 'dotenv';
import { logger } from './config/logger.js';
import { initSentry, captureException } from './config/sentry.js';
import { runMigrations } from './migrations/index.js';
import { createApp } from './app.js';
import storage from './services/storage.js';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
	const secret = process.env.JWT_SECRET || '';
	if (!secret || secret.length < 32 || secret.includes('change-me')) {
		logger.error('Refusing to start: set a strong JWT_SECRET (≥32 chars) in production');
		process.exit(1);
	}
	if (process.env.SHOW_OTP_IN_RESPONSE === 'true') {
		logger.warn('SHOW_OTP_IN_RESPONSE=true in production — disable after smoke tests');
	}
}

await initSentry();
await runMigrations();
await storage.init();

const app = createApp();
const PORT = Number(process.env.PORT || 3001);

process.on('uncaughtException', (err) => {
	captureException(err, { type: 'uncaughtException' });
	logger.error({ err }, 'uncaughtException');
});
process.on('unhandledRejection', (err) => {
	captureException(err, { type: 'unhandledRejection' });
	logger.error({ err }, 'unhandledRejection');
});

app.listen(PORT, () => {
	logger.info(`Grabit API listening on http://localhost:${PORT}`);
});
