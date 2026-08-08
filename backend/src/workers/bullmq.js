import { Queue, Worker } from 'bullmq';
import { getRedis, redisEnabled, pingRedis } from '../config/redis.js';
import { drainOnce } from '../../scripts/outbox-relay.js';
import { expireStaleOrders } from '../workers/order-expire.js';
import pool from '../db.js';
import { logger } from '../config/logger.js';

export const QUEUE_NAME = 'grabit-jobs';

export function createJobsQueue() {
	return new Queue(QUEUE_NAME, { connection: getRedis() });
}

/**
 * Start BullMQ workers for outbox drain + order expire (schedulers).
 * Returns null if Redis unavailable — use poll fallback.
 */
export async function startBullWorkers() {
	if (!redisEnabled()) {
		logger.info('BullMQ skipped (REDIS_DISABLED)');
		return null;
	}
	const ping = await pingRedis();
	if (!ping.ok) {
		logger.warn({ ping }, 'BullMQ skipped — Redis unavailable, use poll workers');
		return null;
	}

	const connection = getRedis();
	const queue = new Queue(QUEUE_NAME, { connection });

	await queue.upsertJobScheduler(
		'outbox-drain',
		{ every: Number(process.env.OUTBOX_POLL_MS || 2000) },
		{
			name: 'outbox-drain',
			opts: { removeOnComplete: 100, removeOnFail: 50 },
		}
	);
	await queue.upsertJobScheduler(
		'order-expire',
		{ every: Number(process.env.ORDER_EXPIRE_POLL_MS || 60_000) },
		{
			name: 'order-expire',
			opts: { removeOnComplete: 50, removeOnFail: 20 },
		}
	);

	const worker = new Worker(
		QUEUE_NAME,
		async (job) => {
			if (job.name === 'outbox-drain') return drainOnce(pool);
			if (job.name === 'order-expire') return expireStaleOrders(pool);
			return { skipped: true };
		},
		{ connection, concurrency: 1 }
	);

	worker.on('failed', (job, err) => {
		logger.error({ job: job?.name, err: String(err.message || err) }, 'bullmq job failed');
	});

	logger.info('BullMQ workers started (outbox + expire)');
	return { queue, worker };
}
