/**
 * PM2 process file — API + outbox consumer + order expire worker.
 * Usage: pm2 start ecosystem.config.cjs
 */
module.exports = {
	apps: [
		{
			name: 'grabit-api',
			script: 'src/server.js',
			instances: 1,
			exec_mode: 'fork',
			env: { NODE_ENV: 'production' },
			max_memory_restart: '512M',
		},
		{
			name: 'grabit-outbox',
			script: 'scripts/outbox-relay.js',
			args: '--watch',
			instances: 1,
			env: { NODE_ENV: 'production' },
			max_memory_restart: '256M',
		},
		{
			name: 'grabit-expire',
			script: 'scripts/order-expire.js',
			args: '--watch',
			instances: 1,
			env: { NODE_ENV: 'production' },
			max_memory_restart: '256M',
		},
	],
};
