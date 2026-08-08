#!/usr/bin/env node
/**
 * Prefer BullMQ repeatable jobs when Redis is up; else poll loop (same as legacy workers).
 * Run: node scripts/workers.js
 */
import dotenv from 'dotenv';
import pool from '../src/db.js';
import { startBullWorkers } from '../src/workers/bullmq.js';
import { drainOnce } from './outbox-relay.js';
import { expireStaleOrders } from '../src/workers/order-expire.js';

dotenv.config();

const outboxMs = Number(process.env.OUTBOX_POLL_MS || 2000);
const expireMs = Number(process.env.ORDER_EXPIRE_POLL_MS || 60_000);

async function pollFallback() {
	console.log('Workers in poll mode (no BullMQ)');
	let lastExpire = 0;
	for (;;) {
		try {
			await drainOnce(pool);
			const now = Date.now();
			if (now - lastExpire >= expireMs) {
				await expireStaleOrders(pool);
				lastExpire = now;
			}
		} catch (err) {
			console.error('worker poll error', err);
		}
		await new Promise((r) => setTimeout(r, outboxMs));
	}
}

async function main() {
	const started = await startBullWorkers();
	if (started) {
		console.log('Workers running via BullMQ — Ctrl+C to stop');
		return;
	}
	await pollFallback();
}

main().catch(async (err) => {
	console.error(err);
	await pool.end();
	process.exit(1);
});
