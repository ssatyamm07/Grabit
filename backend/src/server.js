import dotenv from 'dotenv';
import { logger } from './config/logger.js';
import { runMigrations } from './migrations/index.js';
import { createApp } from './app.js';
import storage from './services/storage.js';

dotenv.config();

await runMigrations();
await storage.init();

const app = createApp();
const PORT = Number(process.env.PORT || 3001);

app.listen(PORT, () => {
	logger.info(`Grabit API listening on http://localhost:${PORT}`);
});
