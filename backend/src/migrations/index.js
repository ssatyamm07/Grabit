import pool from '../db.js';
import { logger } from '../config/logger.js';
import { migration001 } from './001_foundation.js';
import { migration002 } from './002_shopping_lists.js';
import { migration003 } from './003_ops_delivery.js';
import { migration004 } from './004_payments_tracking.js';
import { migration005 } from './005_disputes_services_outbox.js';
import { migration006 } from './006_fix_photo_urls.js';
import { migration007 } from './007_p1_audit_booking_payments.js';
import { migration008 } from './008_reviews_search_analytics.js';
import { migration009 } from './009_search_synonyms.js';

const migrations = [
	migration001,
	migration002,
	migration003,
	migration004,
	migration005,
	migration006,
	migration007,
	migration008,
	migration009,
];

export async function runMigrations() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);

	for (const migration of migrations) {
		const existing = await pool.query(
			'SELECT 1 FROM schema_migrations WHERE id = $1',
			[migration.id]
		);
		if (existing.rowCount > 0) {
			logger.info({ id: migration.id }, 'Migration already applied');
			continue;
		}

		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await migration.up(client);
			await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
			await client.query('COMMIT');
			logger.info({ id: migration.id }, 'Migration applied');
		} catch (err) {
			await client.query('ROLLBACK');
			logger.error({ err, id: migration.id }, 'Migration failed');
			throw err;
		} finally {
			client.release();
		}
	}
}
