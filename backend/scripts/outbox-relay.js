#!/usr/bin/env node
/**
 * Minimal outbox relay: marks unpublished events as published (log only).
 * Run: node scripts/outbox-relay.js
 * Optional loop: OUTBOX_POLL_MS=2000 node scripts/outbox-relay.js --watch
 */
import dotenv from 'dotenv';
import pool from '../src/db.js';

dotenv.config();

const watch = process.argv.includes('--watch');
const pollMs = Number(process.env.OUTBOX_POLL_MS || 2000);
const batch = Number(process.env.OUTBOX_BATCH || 50);

async function drainOnce() {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const rows = await client.query(
			`SELECT id, event_type, aggregate_type, aggregate_id, payload
			 FROM outbox
			 WHERE published_at IS NULL
			 ORDER BY id ASC
			 LIMIT $1
			 FOR UPDATE SKIP LOCKED`,
			[batch]
		);

		for (const row of rows.rows) {
			console.log(
				JSON.stringify({
					relay: 'outbox',
					id: row.id,
					event_type: row.event_type,
					aggregate_type: row.aggregate_type,
					aggregate_id: row.aggregate_id,
				})
			);
			await client.query(`UPDATE outbox SET published_at = NOW() WHERE id = $1`, [row.id]);
		}

		await client.query('COMMIT');
		return rows.rowCount;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

async function main() {
	if (!watch) {
		const n = await drainOnce();
		console.log(`Relayed ${n} events`);
		await pool.end();
		return;
	}

	console.log(`Outbox relay watching every ${pollMs}ms`);
	for (;;) {
		try {
			await drainOnce();
		} catch (err) {
			console.error('relay error', err);
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

main().catch(async (err) => {
	console.error(err);
	await pool.end();
	process.exit(1);
});
