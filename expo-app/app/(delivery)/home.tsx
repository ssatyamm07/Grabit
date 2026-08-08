import { useCallback, useEffect, useRef, useState } from 'react';
import {
	Alert,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
	acceptDeliveryJob,
	completeDeliveryJob,
	formatPaise,
	getDeliveryMe,
	listDeliveryJobs,
	patchDeliveryLocation,
	pickupDeliveryJob,
} from '@/src/api/services';
import { useAuthStore } from '@/src/store/auth.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

type Job = {
	id: number;
	status: string;
	order_id: number;
	order_status?: string;
	total_paise?: number;
	business_name?: string;
	delivery_address_snapshot?: { line1?: string; lat?: number; lng?: number };
};

export default function DeliveryHome() {
	const insets = useSafeAreaInsets();
	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);
	const qc = useQueryClient();
	const [otpByJob, setOtpByJob] = useState<Record<number, string>>({});
	const [sharing, setSharing] = useState(false);
	const watchRef = useRef<Location.LocationSubscription | null>(null);

	const meQ = useQuery({ queryKey: ['delivery-me'], queryFn: getDeliveryMe });
	const jobsQ = useQuery({ queryKey: ['delivery-jobs'], queryFn: () => listDeliveryJobs() });

	const jobs = (jobsQ.data || []) as Job[];
	const available = jobs.filter((j) => j.status === 'unassigned');
	const mine = jobs.filter((j) => j.status === 'assigned' || j.status === 'picked_up');

	const refresh = useCallback(() => {
		void qc.invalidateQueries({ queryKey: ['delivery-jobs'] });
		void qc.invalidateQueries({ queryKey: ['delivery-me'] });
	}, [qc]);

	const acceptMut = useMutation({
		mutationFn: (id: number) => acceptDeliveryJob(id),
		onSuccess: () => refresh(),
		onError: (e: Error) => Alert.alert('Accept failed', e.message),
	});
	const pickupMut = useMutation({
		mutationFn: (id: number) => pickupDeliveryJob(id),
		onSuccess: () => refresh(),
		onError: (e: Error) => Alert.alert('Pickup failed', e.message),
	});
	const completeMut = useMutation({
		mutationFn: ({ id, otp }: { id: number; otp: string }) => completeDeliveryJob(id, otp),
		onSuccess: () => {
			refresh();
			Alert.alert('Delivered', 'Order completed');
		},
		onError: (e: Error) => Alert.alert('Complete failed', e.message),
	});

	async function startLocationShare() {
		const { status } = await Location.requestForegroundPermissionsAsync();
		if (status !== 'granted') {
			Alert.alert('Location needed', 'Enable location to ping rider position for customers.');
			return;
		}
		setSharing(true);
		const ping = async (lat: number, lng: number) => {
			try {
				await patchDeliveryLocation(lat, lng);
			} catch {
				/* ignore transient */
			}
		};
		const current = await Location.getCurrentPositionAsync({
			accuracy: Location.Accuracy.Balanced,
		});
		await ping(current.coords.latitude, current.coords.longitude);

		watchRef.current?.remove();
		watchRef.current = await Location.watchPositionAsync(
			{
				accuracy: Location.Accuracy.Balanced,
				distanceInterval: 40,
				timeInterval: 15_000,
			},
			(pos) => {
				void ping(pos.coords.latitude, pos.coords.longitude);
			}
		);
	}

	function stopLocationShare() {
		watchRef.current?.remove();
		watchRef.current = null;
		setSharing(false);
	}

	useEffect(() => {
		void meQ.refetch();
		return () => {
			watchRef.current?.remove();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function renderJob(item: Job, mode: 'available' | 'mine') {
		return (
			<View style={styles.card}>
				<Text style={styles.cardTitle}>
					Job #{item.id} · Order #{item.order_id}
				</Text>
				<Text style={styles.meta}>
					{item.business_name || 'Store'} · {item.status}
					{item.total_paise != null ? ` · ${formatPaise(Number(item.total_paise))}` : ''}
				</Text>
				{item.delivery_address_snapshot?.line1 ? (
					<Text style={styles.meta}>{item.delivery_address_snapshot.line1}</Text>
				) : null}

				{mode === 'available' ? (
					<Button
						title="Accept job"
						variant="success"
						style={styles.actionBtn}
						loading={acceptMut.isPending}
						onPress={() => acceptMut.mutate(item.id)}
					/>
				) : null}

				{mode === 'mine' && item.status === 'assigned' ? (
					<Button
						title="Picked up from store"
						variant="primary"
						style={styles.actionBtn}
						loading={pickupMut.isPending}
						onPress={() => pickupMut.mutate(item.id)}
					/>
				) : null}

				{mode === 'mine' && item.status === 'picked_up' ? (
					<View style={{ marginTop: spacing.sm, gap: 8 }}>
						<TextInput
							style={styles.input}
							placeholder="Customer delivery OTP"
							placeholderTextColor={brand.textMuted}
							keyboardType="number-pad"
							maxLength={6}
							value={otpByJob[item.id] || ''}
							onChangeText={(t) => setOtpByJob((m) => ({ ...m, [item.id]: t }))}
						/>
						<Button
							title="Complete delivery"
							variant="success"
							loading={completeMut.isPending}
							onPress={() => {
								const otp = (otpByJob[item.id] || '').trim();
								if (otp.length < 4) {
									Alert.alert('OTP required', 'Enter the door OTP from the customer');
									return;
								}
								completeMut.mutate({ id: item.id, otp });
							}}
						/>
					</View>
				) : null}
			</View>
		);
	}

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<View style={styles.header}>
				<View>
					<Text style={styles.title}>Rider desk</Text>
					<Text style={styles.meta}>
						{user?.phone}
						{meQ.data?.partner?.id != null ? ` · partner #${String(meQ.data.partner.id)}` : ''}
					</Text>
				</View>
				<Pressable
					style={[styles.locBtn, sharing && styles.locBtnOn]}
					onPress={() => (sharing ? stopLocationShare() : void startLocationShare())}
				>
					<Ionicons
						name={sharing ? 'navigate' : 'navigate-outline'}
						size={18}
						color={sharing ? colors.neutral[0] : brand.primary}
					/>
					<Text style={[styles.locText, sharing && styles.locTextOn]}>
						{sharing ? 'Sharing' : 'Share GPS'}
					</Text>
				</Pressable>
			</View>

			<FlatList
				data={[
					{ key: 'mine-h', type: 'header' as const, title: 'My active jobs' },
					...mine.map((j) => ({ key: `m-${j.id}`, type: 'job' as const, job: j, mode: 'mine' as const })),
					{ key: 'avail-h', type: 'header' as const, title: 'Available nearby' },
					...available.map((j) => ({
						key: `a-${j.id}`,
						type: 'job' as const,
						job: j,
						mode: 'available' as const,
					})),
				]}
				keyExtractor={(item) => item.key}
				refreshing={jobsQ.isFetching}
				onRefresh={() => void jobsQ.refetch()}
				ListEmptyComponent={
					<EmptyState
						icon={<Ionicons name="bicycle-outline" size={40} color={brand.primary} />}
						title="No jobs"
						subtitle="When vendors mark partner orders ready, they show here."
					/>
				}
				renderItem={({ item }) => {
					if (item.type === 'header') {
						return <Text style={styles.section}>{item.title}</Text>;
					}
					return renderJob(item.job, item.mode);
				}}
				ListFooterComponent={
					<Button
						title="Log out"
						variant="secondary"
						style={{ marginVertical: spacing.md }}
						onPress={async () => {
							stopLocationShare();
							await logout();
							router.replace('/(auth)/login');
						}}
					/>
				}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		marginBottom: spacing.md,
	},
	title: { fontSize: 28, fontWeight: '800', color: brand.text },
	meta: { color: brand.textMuted, marginTop: 4 },
	locBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 999,
		borderWidth: 1.5,
		borderColor: brand.primary,
		backgroundColor: colors.neutral[0],
	},
	locBtnOn: { backgroundColor: brand.primary, borderColor: brand.primary },
	locText: { fontWeight: '700', color: brand.primary, fontSize: 12 },
	locTextOn: { color: colors.neutral[0] },
	section: {
		fontSize: 16,
		fontWeight: '800',
		color: brand.text,
		marginTop: spacing.sm,
		marginBottom: spacing.sm,
	},
	card: { ...surfaces.card, padding: spacing.md, marginBottom: spacing.sm },
	cardTitle: { fontSize: 16, fontWeight: '800', color: brand.text },
	actionBtn: { marginTop: spacing.sm, minHeight: 44 },
	input: {
		backgroundColor: brand.surface,
		borderWidth: 1.5,
		borderColor: colors.blue[200],
		borderRadius: 12,
		paddingHorizontal: spacing.md,
		paddingVertical: 12,
		fontSize: 16,
		color: brand.text,
	},
});
