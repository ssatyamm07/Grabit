#!/usr/bin/env node
/**
 * Expire unaccepted orders and release reserved stock.
 * Once:  node scripts/order-expire.js
 * Watch: ORDER_EXPIRE_POLL_MS=60000 node scripts/order-expire.js --watch
 */
import dotenv from 'dotenv';
import pool from '../src/db.js';
import { expireStaleOrders } from '../src/workers/order-expire.js';

dotenv.config();

const watch = process.argv.includes('--watch');
const pollMs = Number(process.env.ORDER_EXPIRE_POLL_MS || 60_000);

async function main() {
	if (!watch) {
		const result = await expireStaleOrders(pool);
		console.log(JSON.stringify({ worker: 'order-expire', ...result }));
		await pool.end();
		return;
	}

	console.log(`Order expire worker every ${pollMs}ms`);
	for (;;) {
		try {
			const result = await expireStaleOrders(pool);
			if (result.expired > 0) {
				console.log(JSON.stringify({ worker: 'order-expire', ...result }));
			}
		} catch (err) {
			console.error('order-expire error', err);
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

main().catch(async (err) => {
	console.error(err);
	await pool.end();
	process.exit(1);
});
