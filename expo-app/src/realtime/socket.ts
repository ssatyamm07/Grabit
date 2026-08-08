import { io, type Socket } from 'socket.io-client';

import { config } from '@/constants/config';
import { useAuthStore } from '@/src/store/auth.store';

function socketOrigin(): string {
	return config.apiBaseUrl.replace(/\/api\/?$/, '');
}

/** Client prefers Socket.IO when API has it. No REST polling. */
export function isSocketPreferred(): boolean {
	return process.env.EXPO_PUBLIC_SOCKET_ENABLED !== 'false';
}

let socket: Socket | null = null;

export function getRealtimeSocket(): Socket | null {
	return socket;
}

export function connectRealtime(): Socket | null {
	if (!isSocketPreferred()) return null;

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
		reconnection: true,
		reconnectionAttempts: 8,
		reconnectionDelay: 1000,
	});
	return socket;
}

export function disconnectRealtime() {
	socket?.disconnect();
	socket = null;
}

/**
 * Live order room. Updates only via socket events — no interval polling.
 * Returns unsubscribe + whether socket was started.
 */
export function subscribeOrder(
	orderId: number,
	onUpdate: (payload: Record<string, unknown>) => void,
	onStatus?: (state: 'connecting' | 'connected' | 'disconnected' | 'disabled') => void
): () => void {
	if (!isSocketPreferred()) {
		onStatus?.('disabled');
		return () => undefined;
	}

	const s = connectRealtime();
	if (!s) {
		onStatus?.('disabled');
		return () => undefined;
	}

	onStatus?.(s.connected ? 'connected' : 'connecting');

	const handler = (payload: Record<string, unknown>) => {
		if (Number(payload.order_id) === orderId) onUpdate(payload);
	};
	const onConnect = () => {
		onStatus?.('connected');
		s.emit('order:subscribe', orderId);
	};
	const onDisconnect = () => onStatus?.('disconnected');

	s.on('order:update', handler);
	s.on('connect', onConnect);
	s.on('disconnect', onDisconnect);

	if (s.connected) {
		s.emit('order:subscribe', orderId);
	}

	return () => {
		s.emit('order:unsubscribe', orderId);
		s.off('order:update', handler);
		s.off('connect', onConnect);
		s.off('disconnect', onDisconnect);
	};
}
