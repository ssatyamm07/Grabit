import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState } from '@/components/ui/EmptyState';
import { formatPaise, listMyOrders } from '@/src/api/services';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

const STATUS_COLOR: Record<string, string> = {
	placed: colors.yellow[600],
	accepted: brand.primary,
	preparing: brand.primary,
	ready: brand.success,
	picked: brand.success,
	delivered: brand.success,
	rejected: colors.danger,
	cancelled: colors.danger,
	expired: colors.danger,
};

export default function OrdersScreen() {
	const insets = useSafeAreaInsets();
	const ordersQ = useQuery({ queryKey: ['my-orders'], queryFn: listMyOrders });

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<Text style={styles.title}>Orders</Text>
			<FlatList
				data={(ordersQ.data || []) as Array<{
					id: number;
					status: string;
					total_paise: number;
					business_name?: string;
				}>}
				keyExtractor={(item) => String(item.id)}
				contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
				refreshing={ordersQ.isFetching}
				onRefresh={() => void ordersQ.refetch()}
				ListEmptyComponent={
					<EmptyState
						icon={<Ionicons name="receipt-outline" size={40} color={brand.primary} />}
						title="No orders yet"
						subtitle="Place a COD order from a neighbourhood store."
					/>
				}
				renderItem={({ item }) => (
					<View style={styles.card}>
						<View style={styles.row}>
							<Text style={styles.id}>#{item.id}</Text>
							<View
								style={[
									styles.pill,
									{ backgroundColor: `${STATUS_COLOR[item.status] || brand.textMuted}22` },
								]}
							>
								<Text style={[styles.pillText, { color: STATUS_COLOR[item.status] || brand.text }]}>
									{item.status}
								</Text>
							</View>
						</View>
						<Text style={styles.store}>{item.business_name || 'Store order'}</Text>
						<Text style={styles.total}>{formatPaise(item.total_paise)}</Text>
					</View>
				)}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	title: { fontSize: 28, fontWeight: '800', color: brand.text, marginBottom: spacing.md },
	card: { ...surfaces.card, padding: spacing.md, marginBottom: spacing.sm },
	row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
	id: { fontWeight: '800', fontSize: 16, color: brand.text },
	pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
	pillText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
	store: { marginTop: 8, color: brand.textMuted },
	total: { marginTop: 4, fontWeight: '800', color: brand.primary, fontSize: 16 },
});
