import http from 'http';

/**
 * Minimal request helper for Express apps (no supertest dependency).
 * Usage: const res = await request(app).post('/api/...').set('Authorization', '...').send({})
 */
export function request(app) {
	const state = { method: 'GET', path: '/', headers: {}, body: undefined };

	const api = {
		get(path) {
			state.method = 'GET';
			state.path = path;
			return api;
		},
		post(path) {
			state.method = 'POST';
			state.path = path;
			return api;
		},
		put(path) {
			state.method = 'PUT';
			state.path = path;
			return api;
		},
		patch(path) {
			state.method = 'PATCH';
			state.path = path;
			return api;
		},
		delete(path) {
			state.method = 'DELETE';
			state.path = path;
			return api;
		},
		set(key, value) {
			state.headers[key] = value;
			return api;
		},
		send(body) {
			state.body = body;
			return api.then();
		},
		then(resolve, reject) {
			return run(app, state).then(resolve, reject);
		},
	};
	return api;
}

function run(app, state) {
	return new Promise((resolve, reject) => {
		const server = http.createServer(app);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			const headers = { ...state.headers };
			let body;
			if (state.body !== undefined) {
				body = JSON.stringify(state.body);
				headers['Content-Type'] = headers['Content-Type'] || 'application/json';
				headers['Content-Length'] = Buffer.byteLength(body);
			}

			const req = http.request(
				{
					hostname: '127.0.0.1',
					port,
					path: state.path,
					method: state.method,
					headers,
				},
				(res) => {
					const chunks = [];
					res.on('data', (c) => chunks.push(c));
					res.on('end', () => {
						server.close();
						const raw = Buffer.concat(chunks).toString('utf8');
						let parsed = {};
						try {
							parsed = raw ? JSON.parse(raw) : {};
						} catch {
							parsed = { raw };
						}
						resolve({ status: res.statusCode, body: parsed, headers: res.headers });
					});
				}
			);
			req.on('error', (err) => {
				server.close();
				reject(err);
			});
			if (body) req.write(body);
			req.end();
		});
	});
}
