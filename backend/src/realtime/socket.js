import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../config/logger.js';

let io = null;

export function getIO() {
	return io;
}

export function attachRealtime(httpServer) {
	io = new Server(httpServer, {
		cors: {
			origin: true,
			credentials: true,
		},
		path: '/socket.io',
	});

	io.use((socket, next) => {
		try {
			const token =
				socket.handshake.auth?.token ||
				String(socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
			if (!token) return next(new Error('unauthorized'));
			socket.user = jwt.verify(token, process.env.JWT_SECRET);
			next();
		} catch {
			next(new Error('unauthorized'));
		}
	});

	io.on('connection', (socket) => {
		socket.join(`user:${socket.user.id}`);
		socket.on('order:subscribe', (orderId) => {
			const id = Number(orderId);
			if (Number.isInteger(id)) socket.join(`order:${id}`);
		});
		socket.on('order:unsubscribe', (orderId) => {
			const id = Number(orderId);
			if (Number.isInteger(id)) socket.leave(`order:${id}`);
		});
	});

	logger.info('Socket.IO realtime attached');
	return io;
}

export function emitOrderUpdate(orderId, payload) {
	if (!io) return;
	io.to(`order:${orderId}`).emit('order:update', { order_id: orderId, ...payload });
}

export function emitToUser(userId, event, payload) {
	if (!io) return;
	io.to(`user:${userId}`).emit(event, payload);
}
