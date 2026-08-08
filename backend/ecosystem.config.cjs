/**
 * PM2 — API + unified workers (BullMQ when Redis up, else poll).
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
			name: 'grabit-workers',
			script: 'scripts/workers.js',
			instances: 1,
			env: { NODE_ENV: 'production' },
			max_memory_restart: '256M',
		},
	],
};
