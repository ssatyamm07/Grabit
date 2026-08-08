import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { getOrderTracking } from '@/src/api/services';
import { isSocketPreferred, subscribeOrder } from '@/src/realtime/socket';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

type SocketState = 'connecting' | 'connected' | 'disconnected' | 'disabled';

export default function OrderTrackScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const orderId = Number(id);
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const [live, setLive] = useState<Record<string, unknown> | null>(null);
	const [socketState, setSocketState] = useState<SocketState>(
		isSocketPreferred() ? 'connecting' : 'disabled'
	);

	// One-shot REST load only — no polling. Live path is Socket.IO.
	const trackQ = useQuery({
		queryKey: ['order-track', orderId],
		queryFn: () => getOrderTracking(orderId),
		enabled: Number.isInteger(orderId) && orderId > 0,
		refetchOnWindowFocus: false,
		refetchInterval: false,
	});

	useEffect(() => {
		if (!Number.isInteger(orderId) || orderId < 1) return;
		return subscribeOrder(
			orderId,
			(payload) => {
				setLive(payload);
				// Event-driven refresh when status changes (not an interval poll)
				if (payload.status != null || payload.order != null) {
					void trackQ.refetch();
				}
			},
			setSocketState
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [orderId]);

	const status = String(live?.status || trackQ.data?.status || '…');
	const vendorName = trackQ.data?.vendor?.business_name;
	const job = trackQ.data?.job;
	const riderLat =
		live?.type === 'rider_location'
			? Number(live.lat)
			: job?.partner_lat != null
				? Number(job.partner_lat)
				: null;
	const riderLng =
		live?.type === 'rider_location'
			? Number(live.lng)
			: job?.partner_lng != null
				? Number(job.partner_lng)
				: null;

	const liveHint =
		socketState === 'connected'
			? 'Live via Socket.IO'
			: socketState === 'connecting'
				? 'Connecting live…'
				: socketState === 'disconnected'
					? 'Live disconnected — pull refresh below'
					: 'REST only — tap Refresh for latest';

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<Pressable onPress={() => router.back()} style={styles.back}>
				<Ionicons name="arrow-back" size={18} color={brand.primary} />
				<Text style={styles.backText}>Orders</Text>
			</Pressable>
			<Text style={styles.title}>Track #{orderId}</Text>

			{trackQ.isLoading ? (
				<ActivityIndicator color={brand.primary} style={{ marginTop: 24 }} />
			) : (
				<View style={styles.card}>
					<View style={styles.row}>
						<Ionicons name="bicycle-outline" size={22} color={brand.primary} />
						<Text style={styles.status}>{status}</Text>
					</View>
					{vendorName ? <Text style={styles.meta}>{vendorName}</Text> : null}
					{trackQ.data?.eta_meters != null || trackQ.data?.eta != null ? (
						<Text style={styles.meta}>
							ETA distance ~
							{Math.round(Number(trackQ.data.eta_meters ?? trackQ.data.eta))} m
						</Text>
					) : null}
					{riderLat != null && riderLng != null ? (
						<View style={styles.liveBox}>
							<Text style={styles.liveLabel}>Rider live</Text>
							<Text style={styles.meta}>
								{riderLat.toFixed(5)}, {riderLng.toFixed(5)}
							</Text>
						</View>
					) : (
						<Text style={styles.meta}>Waiting for rider location…</Text>
					)}
					<Text style={styles.hint}>{liveHint}</Text>
					{(socketState === 'disabled' || socketState === 'disconnected') && (
						<Pressable style={styles.refreshBtn} onPress={() => void trackQ.refetch()}>
							<Text style={styles.refreshText}>
								{trackQ.isFetching ? 'Refreshing…' : 'Refresh'}
							</Text>
						</Pressable>
					)}
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
	backText: { color: brand.primary, fontWeight: '700' },
	title: { fontSize: 26, fontWeight: '800', color: brand.text, marginVertical: spacing.md },
	card: { ...surfaces.card, padding: spacing.lg, gap: 10 },
	row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	status: { fontSize: 20, fontWeight: '800', color: brand.primary, textTransform: 'capitalize' },
	meta: { color: brand.textMuted },
	liveBox: {
		marginTop: 8,
		padding: 12,
		borderRadius: 12,
		backgroundColor: colors.blue[50],
	},
	liveLabel: { fontWeight: '800', color: brand.primary, marginBottom: 4 },
	hint: { marginTop: 8, fontSize: 12, color: brand.textMuted },
	refreshBtn: {
		marginTop: 8,
		alignSelf: 'flex-start',
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 10,
		backgroundColor: brand.primary,
	},
	refreshText: { color: colors.neutral[0], fontWeight: '700' },
});
