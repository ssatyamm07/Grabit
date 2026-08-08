import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { listDisputes, getPilotAnalytics, resolveDispute } from '@/src/api/services';
import { useAuthStore } from '@/src/store/auth.store';
import { useToastStore } from '@/src/store/toast.store';
import { brand } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

const STAFF = new Set(['super_admin', 'regional_admin', 'support', 'field_agent']);

export default function AdminHome() {
	const insets = useSafeAreaInsets();
	const role = useAuthStore((s) => s.user?.role);
	const toast = useToastStore((s) => s.show);

	const analyticsQ = useQuery({
		queryKey: ['pilot-analytics'],
		queryFn: getPilotAnalytics,
		enabled: !!role && STAFF.has(role) && role !== 'field_agent',
	});
	const disputesQ = useQuery({
		queryKey: ['disputes'],
		queryFn: () => listDisputes(),
		enabled: !!role && STAFF.has(role),
	});

	if (!role || !STAFF.has(role)) {
		return <Redirect href={'/(customer)/(tabs)' as never} />;
	}

	const metrics = (analyticsQ.data?.metrics || {}) as Record<string, number | null>;

	return (
		<ScrollView
			style={styles.screen}
			contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: 40 }}
		>
			<Text style={styles.title}>Ops</Text>
			<Text style={styles.sub}>Pilot analytics & disputes</Text>

			<View style={styles.card}>
				<Text style={styles.section}>Pilot metrics</Text>
				{analyticsQ.isFetching ? (
					<Text style={styles.meta}>Loading…</Text>
				) : analyticsQ.isError ? (
					<Text style={styles.meta}>Could not load analytics for this role.</Text>
				) : (
					<>
						<Text style={styles.meta}>Placed: {metrics.orders_placed ?? '—'}</Text>
						<Text style={styles.meta}>Delivered: {metrics.orders_delivered ?? '—'}</Text>
						<Text style={styles.meta}>Fill rate: {metrics.fill_rate ?? '—'}</Text>
						<Text style={styles.meta}>Accept rate: {metrics.acceptance_rate ?? '—'}</Text>
						<Text style={styles.meta}>GMV (paise): {metrics.gmv_paise ?? '—'}</Text>
					</>
				)}
			</View>

			<Text style={styles.section}>Open disputes</Text>
			{(disputesQ.data || []).length === 0 ? (
				<Text style={styles.meta}>No disputes</Text>
			) : (
				(disputesQ.data || []).map((d) => (
					<View key={String(d.id)} style={styles.card}>
						<Text style={styles.cardTitle}>
							#{String(d.id)} · {String(d.status)}
						</Text>
						<Text style={styles.meta}>Order #{String(d.order_id)}</Text>
						<Text style={styles.meta}>{String(d.reason || d.description || '')}</Text>
						{d.status === 'open' || d.status === 'investigating' ? (
							<Button
								title="Resolve (no refund)"
								variant="secondary"
								style={{ marginTop: 10 }}
								onPress={async () => {
									try {
										await resolveDispute(Number(d.id), 'Resolved via ops shell', false);
										toast('Dispute resolved', 'success');
										void disputesQ.refetch();
									} catch (e) {
										toast((e as Error).message || 'Failed', 'error');
									}
								}}
							/>
						) : null}
					</View>
				))
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	title: { fontSize: 28, fontWeight: '800', color: brand.text },
	sub: { color: brand.textMuted, marginBottom: spacing.md },
	section: { fontSize: 16, fontWeight: '800', color: brand.text, marginBottom: 8, marginTop: 8 },
	card: { ...surfaces.card, padding: spacing.md, marginBottom: spacing.sm },
	cardTitle: { fontWeight: '800', fontSize: 16, color: brand.text },
	meta: { color: brand.textMuted, marginTop: 4 },
});
