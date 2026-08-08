#!/usr/bin/env node
/**
 * Outbox consumer: drain unpublished events → push + SMS (+ notification_log).
 * Run once:  node scripts/outbox-relay.js
 * Watch:     OUTBOX_POLL_MS=2000 node scripts/outbox-relay.js --watch
 */
import dotenv from 'dotenv';
import pool from '../src/db.js';
import { consumeOutboxEvent } from '../src/events/consumers.js';

dotenv.config();

const watch = process.argv.includes('--watch');
const pollMs = Number(process.env.OUTBOX_POLL_MS || 2000);
const batch = Number(process.env.OUTBOX_BATCH || 50);
const maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS || 5);

export async function drainOnce(db = pool) {
	const client = await db.connect();
	let published = 0;
	let failed = 0;
	try {
		await client.query('BEGIN');
		const rows = await client.query(
			`SELECT id, event_type, aggregate_type, aggregate_id, payload, attempts
			 FROM outbox
			 WHERE published_at IS NULL
			 ORDER BY id ASC
			 LIMIT $1
			 FOR UPDATE SKIP LOCKED`,
			[batch]
		);

		for (const row of rows.rows) {
			try {
				const result = await consumeOutboxEvent(client, row);
				await client.query(
					`UPDATE outbox
					 SET published_at = NOW(), last_error = NULL
					 WHERE id = $1`,
					[row.id]
				);
				published += 1;
				console.log(
					JSON.stringify({
						relay: 'outbox',
						id: row.id,
						event_type: row.event_type,
						notified: result.notified,
						status: 'published',
					})
				);
			} catch (err) {
				failed += 1;
				const attempts = (row.attempts || 0) + 1;
				const poison = attempts >= maxAttempts;
				await client.query(
					`UPDATE outbox
					 SET attempts = $1,
					     last_error = $2,
					     published_at = CASE WHEN $3 THEN NOW() ELSE published_at END
					 WHERE id = $4`,
					[attempts, String(err.message || err).slice(0, 500), poison, row.id]
				);
				console.error(
					JSON.stringify({
						relay: 'outbox',
						id: row.id,
						event_type: row.event_type,
						status: poison ? 'poisoned' : 'retry',
						attempts,
						error: String(err.message || err),
					})
				);
			}
		}

		await client.query('COMMIT');
		return { published, failed, scanned: rows.rowCount };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

async function main() {
	if (!watch) {
		const result = await drainOnce();
		console.log(
			`Relayed ${result.published} events (${result.failed} failed, ${result.scanned} scanned)`
		);
		await pool.end();
		return;
	}

	console.log(`Outbox consumer watching every ${pollMs}ms (batch=${batch})`);
	for (;;) {
		try {
			await drainOnce();
		} catch (err) {
			console.error('relay error', err);
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

const isMain = process.argv[1] && process.argv[1].endsWith('outbox-relay.js');
if (isMain) {
	main().catch(async (err) => {
		console.error(err);
		await pool.end();
		process.exit(1);
	});
}
