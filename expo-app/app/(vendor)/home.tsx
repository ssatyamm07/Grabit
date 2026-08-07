import { useState } from 'react';
import {
	ActivityIndicator,
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

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
	createListing,
	formatPaise,
	getLedger,
	listMyListings,
	listVendorOrders,
	searchCatalog,
	transitionOrder,
} from '@/src/api/services';
import { useAuthStore } from '@/src/store/auth.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

export default function VendorHome() {
	const insets = useSafeAreaInsets();
	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);
	const qc = useQueryClient();
	const [tab, setTab] = useState<'orders' | 'listings' | 'add'>('orders');
	const [search, setSearch] = useState('Amul');
	const [priceRupees, setPriceRupees] = useState('33');
	const [qty, setQty] = useState('20');
	const [selectedMasterId, setSelectedMasterId] = useState<number | null>(null);

	const listingsQ = useQuery({ queryKey: ['my-listings'], queryFn: listMyListings });
	const ordersQ = useQuery({ queryKey: ['vendor-orders'], queryFn: listVendorOrders });
	const ledgerQ = useQuery({ queryKey: ['ledger'], queryFn: getLedger });
	const catalogQ = useQuery({
		queryKey: ['catalog', search],
		queryFn: () => searchCatalog(search),
		enabled: tab === 'add' && search.trim().length > 0,
	});

	const openOrders = (ordersQ.data || []).filter((o) =>
		['placed', 'accepted', 'preparing', 'ready', 'picked'].includes(String(o.status))
	);

	const addMut = useMutation({
		mutationFn: async () => {
			if (!selectedMasterId) throw new Error('Pick a master product');
			const price_paise = Math.round(Number(priceRupees) * 100);
			const stock = Number(qty);
			if (!Number.isFinite(price_paise) || price_paise < 0) throw new Error('Invalid price');
			if (!Number.isInteger(stock) || stock < 0) throw new Error('Invalid qty');
			return createListing({ master_product_id: selectedMasterId, price_paise, qty: stock });
		},
		onSuccess: () => {
			Alert.alert('Listed', 'Product added to your store');
			setSelectedMasterId(null);
			setTab('listings');
			void qc.invalidateQueries({ queryKey: ['my-listings'] });
		},
		onError: (err: Error) => Alert.alert('Failed', err.message),
	});

	const transitionMut = useMutation({
		mutationFn: ({ id, to }: { id: number; to: string }) => transitionOrder(id, to),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ['vendor-orders'] });
			void qc.invalidateQueries({ queryKey: ['my-listings'] });
			void qc.invalidateQueries({ queryKey: ['ledger'] });
		},
		onError: (err: Error) => Alert.alert('Update failed', err.message),
	});

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<View style={styles.header}>
				<View>
					<Text style={styles.title}>Vendor desk</Text>
					<Text style={styles.meta}>
						{user?.phone} · {formatPaise(ledgerQ.data?.balance_paise ?? 0)} receivable
					</Text>
				</View>
			</View>

			<View style={styles.stats}>
				{[
					{ label: 'Listings', value: listingsQ.data?.listings.length ?? 0, bg: colors.blue[50], color: brand.primary },
					{ label: 'Open', value: openOrders.length, bg: colors.yellow[50], color: colors.yellow[600] },
					{
						label: 'Done',
						value: (ordersQ.data || []).filter((o) => o.status === 'delivered').length,
						bg: colors.green[50],
						color: brand.success,
					},
				].map((s) => (
					<View key={s.label} style={[styles.stat, { backgroundColor: s.bg }]}>
						<Text style={[styles.statNum, { color: s.color }]}>{s.value}</Text>
						<Text style={styles.statLabel}>{s.label}</Text>
					</View>
				))}
			</View>

			<View style={styles.tabs}>
				{(['orders', 'listings', 'add'] as const).map((t) => (
					<Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
						<Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
							{t === 'add' ? '+ Add' : t[0].toUpperCase() + t.slice(1)}
						</Text>
					</Pressable>
				))}
			</View>

			{tab === 'orders' ? (
				<FlatList
					data={(ordersQ.data || []) as Array<{ id: number; status: string; total_paise: number }>}
					keyExtractor={(item) => String(item.id)}
					refreshing={ordersQ.isFetching}
					onRefresh={() => void ordersQ.refetch()}
					ListEmptyComponent={
						<EmptyState
							icon={<Ionicons name="receipt-outline" size={36} color={brand.primary} />}
							title="No orders"
							subtitle="Customer COD orders will appear here."
						/>
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Text style={styles.cardTitle}>
								#{item.id} · {item.status} · {formatPaise(item.total_paise)}
							</Text>
							<View style={styles.actions}>
								{item.status === 'placed' ? (
									<>
										<Button title="Accept" variant="success" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'accepted' })} />
										<Button title="Reject" variant="accent" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'rejected' })} />
									</>
								) : null}
								{item.status === 'accepted' ? (
									<Button title="Preparing" variant="primary" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'preparing' })} />
								) : null}
								{item.status === 'preparing' ? (
									<Button title="Ready" variant="primary" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'ready' })} />
								) : null}
								{item.status === 'ready' ? (
									<Button title="Picked" variant="primary" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'picked' })} />
								) : null}
								{item.status === 'picked' ? (
									<Button title="Delivered" variant="success" style={styles.actionBtn} onPress={() => transitionMut.mutate({ id: item.id, to: 'delivered' })} />
								) : null}
							</View>
						</View>
					)}
				/>
			) : null}

			{tab === 'listings' ? (
				<FlatList
					data={listingsQ.data?.listings || []}
					keyExtractor={(item) => String(item.id)}
					refreshing={listingsQ.isFetching}
					onRefresh={() => void listingsQ.refetch()}
					ListEmptyComponent={
						<EmptyState title="No listings" subtitle="Add products from the master catalog." />
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Text style={styles.cardTitle}>{item.name}</Text>
							<Text style={styles.meta}>
								{formatPaise(item.price_paise)} · avail {item.available_qty} (reserved {item.reserved_qty})
							</Text>
						</View>
					)}
				/>
			) : null}

			{tab === 'add' ? (
				<View style={{ flex: 1 }}>
					<TextInput
						style={styles.input}
						value={search}
						onChangeText={setSearch}
						placeholder="Search master catalog"
						placeholderTextColor={brand.textMuted}
					/>
					<View style={styles.rowInputs}>
						<TextInput style={[styles.input, { flex: 1 }]} value={priceRupees} onChangeText={setPriceRupees} keyboardType="decimal-pad" placeholder="Price ₹" placeholderTextColor={brand.textMuted} />
						<TextInput style={[styles.input, { flex: 1 }]} value={qty} onChangeText={setQty} keyboardType="number-pad" placeholder="Qty" placeholderTextColor={brand.textMuted} />
					</View>
					{catalogQ.isFetching ? <ActivityIndicator color={brand.primary} /> : null}
					<FlatList
						data={catalogQ.data || []}
						keyExtractor={(item) => String(item.id)}
						renderItem={({ item }) => (
							<Pressable
								style={[styles.card, selectedMasterId === item.id && styles.selected]}
								onPress={() => setSelectedMasterId(item.id)}
							>
								<Text style={styles.cardTitle}>{item.name}</Text>
								<Text style={styles.meta}>{[item.brand, item.unit_label].filter(Boolean).join(' · ')}</Text>
							</Pressable>
						)}
					/>
					<Button
						title="Add listing"
						loading={addMut.isPending}
						disabled={!selectedMasterId}
						onPress={() => addMut.mutate()}
					/>
				</View>
			) : null}

			<Button
				title="Log out"
				variant="secondary"
				style={{ marginVertical: spacing.md }}
				onPress={async () => {
					await logout();
					router.replace('/(auth)/login');
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	header: { marginBottom: spacing.sm },
	title: { fontSize: 28, fontWeight: '800', color: brand.text },
	meta: { color: brand.textMuted, marginTop: 4 },
	stats: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
	stat: { flex: 1, borderRadius: 14, padding: spacing.sm, alignItems: 'center' },
	statNum: { fontSize: 20, fontWeight: '800' },
	statLabel: { fontSize: 12, color: brand.textMuted, fontWeight: '600' },
	tabs: { flexDirection: 'row', gap: 8, marginVertical: spacing.md },
	tab: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 999,
		backgroundColor: colors.neutral[100],
	},
	tabActive: { backgroundColor: brand.primary },
	tabText: { fontWeight: '700', color: brand.textMuted, fontSize: 13 },
	tabTextActive: { color: colors.neutral[0] },
	card: { ...surfaces.card, padding: spacing.md, marginBottom: spacing.sm },
	selected: { borderColor: brand.primary, borderWidth: 2 },
	cardTitle: { fontSize: 16, fontWeight: '700', color: brand.text },
	actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
	actionBtn: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, flexGrow: 0 },
	input: {
		backgroundColor: brand.surface,
		borderWidth: 1.5,
		borderColor: colors.blue[200],
		borderRadius: 12,
		paddingHorizontal: spacing.md,
		paddingVertical: 12,
		marginBottom: spacing.sm,
		fontSize: 16,
		color: brand.text,
	},
	rowInputs: { flexDirection: 'row', gap: 8 },
});
