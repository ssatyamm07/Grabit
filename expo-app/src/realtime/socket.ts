import { io, type Socket } from 'socket.io-client';

import { config } from '@/constants/config';
import { useAuthStore } from '@/src/store/auth.store';

function socketOrigin(): string {
	return config.apiBaseUrl.replace(/\/api\/?$/, '');
}

let socket: Socket | null = null;

export function getRealtimeSocket(): Socket | null {
	return socket;
}

export function connectRealtime(): Socket | null {
	const token = useAuthStore.getState().accessToken;
	if (!token) return null;

	if (socket?.connected) return socket;
	if (socket) {
		socket.auth = { token };
		socket.connect();
		return socket;
	}

	socket = io(socketOrigin(), {
		path: '/socket.io',
		transports: ['websocket'],
		auth: { token },
		autoConnect: true,
	});
	return socket;
}

export function disconnectRealtime() {
	socket?.disconnect();
	socket = null;
}

export function subscribeOrder(
	orderId: number,
	onUpdate: (payload: Record<string, unknown>) => void
): () => void {
	const s = connectRealtime();
	if (!s) return () => undefined;

	const handler = (payload: Record<string, unknown>) => {
		if (Number(payload.order_id) === orderId) onUpdate(payload);
	};
	s.emit('order:subscribe', orderId);
	s.on('order:update', handler);
	return () => {
		s.emit('order:unsubscribe', orderId);
		s.off('order:update', handler);
	};
}
