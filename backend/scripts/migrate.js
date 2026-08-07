import dotenv from 'dotenv';
import { runMigrations } from '../src/migrations/index.js';
import pool from '../src/db.js';

dotenv.config();

try {
	await runMigrations();
	console.log('Migrations complete');
	await pool.end();
	process.exit(0);
} catch (err) {
	console.error(err);
	process.exit(1);
}
