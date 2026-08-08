import { useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	FlatList,
	Pressable,
	StyleSheet,
	Switch,
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
	getVendorMe,
	listMyListings,
	listVendorOrders,
	patchInventory,
	patchListing,
	patchVendorMe,
	searchCatalog,
	transitionOrder,
} from '@/src/api/services';
import { useAuthStore } from '@/src/store/auth.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

type VendorOrder = {
	id: number;
	status: string;
	total_paise: number;
	fulfillment_mode?: string;
};

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
	const [lastOtp, setLastOtp] = useState<string | null>(null);

	const vendorQ = useQuery({ queryKey: ['vendor-me'], queryFn: getVendorMe });
	const listingsQ = useQuery({ queryKey: ['my-listings'], queryFn: listMyListings });
	const ordersQ = useQuery({ queryKey: ['vendor-orders'], queryFn: listVendorOrders });
	const ledgerQ = useQuery({ queryKey: ['ledger'], queryFn: getLedger });
	const catalogQ = useQuery({
		queryKey: ['catalog', search],
		queryFn: () => searchCatalog(search),
		enabled: tab === 'add' && search.trim().length > 0,
	});

	const isOpen = Boolean(vendorQ.data?.vendor?.is_open);
	const openOrders = ((ordersQ.data || []) as VendorOrder[]).filter((o) =>
		['placed', 'accepted', 'preparing', 'ready', 'picked'].includes(String(o.status))
	);

	const openMut = useMutation({
		mutationFn: (next: boolean) => patchVendorMe({ is_open: next }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ['vendor-me'] }),
		onError: (err: Error) => Alert.alert('Failed', err.message),
	});

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
		onSuccess: (res) => {
			if (res.delivery_otp) {
				setLastOtp(res.delivery_otp);
				Alert.alert('Ready', `Door OTP for rider/customer: ${res.delivery_otp}`);
			}
			void qc.invalidateQueries({ queryKey: ['vendor-orders'] });
			void qc.invalidateQueries({ queryKey: ['my-listings'] });
			void qc.invalidateQueries({ queryKey: ['ledger'] });
		},
		onError: (err: Error) => Alert.alert('Update failed', err.message),
	});

	const listingMut = useMutation({
		mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
			patchListing(id, { is_active }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-listings'] }),
		onError: (err: Error) => Alert.alert('Failed', err.message),
	});

	const stockMut = useMutation({
		mutationFn: ({ id, qty: nextQty }: { id: number; qty: number }) => patchInventory(id, nextQty),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-listings'] }),
		onError: (err: Error) => Alert.alert('Stock failed', err.message),
	});

	function nextActions(item: VendorOrder) {
		const partner = item.fulfillment_mode === 'partner';
		if (item.status === 'placed') {
			return (
				<>
					<Button
						title="Accept"
						variant="success"
						style={styles.actionBtn}
						onPress={() => transitionMut.mutate({ id: item.id, to: 'accepted' })}
					/>
					<Button
						title="Reject"
						variant="accent"
						style={styles.actionBtn}
						onPress={() => transitionMut.mutate({ id: item.id, to: 'rejected' })}
					/>
				</>
			);
		}
		if (item.status === 'accepted') {
			return (
				<Button
					title="Preparing"
					variant="primary"
					style={styles.actionBtn}
					onPress={() => transitionMut.mutate({ id: item.id, to: 'preparing' })}
				/>
			);
		}
		if (item.status === 'preparing') {
			return (
				<Button
					title="Mark ready"
					variant="primary"
					style={styles.actionBtn}
					onPress={() => transitionMut.mutate({ id: item.id, to: 'ready' })}
				/>
			);
		}
		if (item.status === 'ready') {
			if (partner) {
				return (
					<Text style={styles.hint}>Partner delivery — waiting for rider pickup</Text>
				);
			}
			return (
				<Button
					title="Picked (self)"
					variant="primary"
					style={styles.actionBtn}
					onPress={() => transitionMut.mutate({ id: item.id, to: 'picked' })}
				/>
			);
		}
		if (item.status === 'picked' && !partner) {
			return (
				<Button
					title="Delivered"
					variant="success"
					style={styles.actionBtn}
					onPress={() => transitionMut.mutate({ id: item.id, to: 'delivered' })}
				/>
			);
		}
		return null;
	}

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<View style={styles.header}>
				<View style={{ flex: 1 }}>
					<Text style={styles.title}>
						{String(vendorQ.data?.vendor?.business_name || 'Vendor desk')}
					</Text>
					<Text style={styles.meta}>
						{user?.phone} · {formatPaise(ledgerQ.data?.balance_paise ?? 0)} receivable
					</Text>
				</View>
				<View style={styles.openRow}>
					<Text style={[styles.openLabel, { color: isOpen ? brand.success : brand.textMuted }]}>
						{isOpen ? 'Open' : 'Closed'}
					</Text>
					<Switch
						value={isOpen}
						onValueChange={(v) => openMut.mutate(v)}
						trackColor={{ false: colors.neutral[200], true: colors.green[300] }}
						thumbColor={isOpen ? brand.success : colors.neutral[0]}
					/>
				</View>
			</View>

			{lastOtp ? (
				<View style={styles.otpBanner}>
					<Text style={styles.otpText}>Last door OTP: {lastOtp}</Text>
				</View>
			) : null}

			<View style={styles.stats}>
				{[
					{
						label: 'Listings',
						value: listingsQ.data?.listings.length ?? 0,
						bg: colors.blue[50],
						color: brand.primary,
					},
					{ label: 'Open', value: openOrders.length, bg: colors.yellow[50], color: colors.yellow[600] },
					{
						label: 'Done',
						value: ((ordersQ.data || []) as VendorOrder[]).filter((o) => o.status === 'delivered')
							.length,
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
					<Pressable
						key={t}
						style={[styles.tab, tab === t && styles.tabActive]}
						onPress={() => setTab(t)}
					>
						<Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
							{t === 'add' ? '+ Add' : t[0].toUpperCase() + t.slice(1)}
						</Text>
					</Pressable>
				))}
			</View>

			{tab === 'orders' ? (
				<FlatList
					data={(ordersQ.data || []) as VendorOrder[]}
					keyExtractor={(item) => String(item.id)}
					refreshing={ordersQ.isFetching}
					onRefresh={() => void ordersQ.refetch()}
					ListEmptyComponent={
						<EmptyState
							icon={<Ionicons name="receipt-outline" size={36} color={brand.primary} />}
							title="No orders"
							subtitle="Customer orders will appear here."
						/>
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Text style={styles.cardTitle}>
								#{item.id} · {item.status} · {formatPaise(item.total_paise)}
							</Text>
							<Text style={styles.meta}>
								Fulfillment: {item.fulfillment_mode || 'default'}
							</Text>
							<View style={styles.actions}>{nextActions(item)}</View>
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
								{formatPaise(item.price_paise)} · avail {item.available_qty} (reserved{' '}
								{item.reserved_qty})
							</Text>
							<View style={styles.actions}>
								<Button
									title="+5 stock"
									variant="secondary"
									style={styles.actionBtn}
									onPress={() =>
										stockMut.mutate({ id: item.id, qty: item.qty + 5 })
									}
								/>
								<Button
									title="Deactivate"
									variant="accent"
									style={styles.actionBtn}
									onPress={() => listingMut.mutate({ id: item.id, is_active: false })}
								/>
							</View>
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
						<TextInput
							style={[styles.input, { flex: 1 }]}
							value={priceRupees}
							onChangeText={setPriceRupees}
							keyboardType="decimal-pad"
							placeholder="Price ₹"
							placeholderTextColor={brand.textMuted}
						/>
						<TextInput
							style={[styles.input, { flex: 1 }]}
							value={qty}
							onChangeText={setQty}
							keyboardType="number-pad"
							placeholder="Qty"
							placeholderTextColor={brand.textMuted}
						/>
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
								<Text style={styles.meta}>
									{[item.brand, item.unit_label].filter(Boolean).join(' · ')}
								</Text>
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
	header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: spacing.sm },
	title: { fontSize: 24, fontWeight: '800', color: brand.text },
	meta: { color: brand.textMuted, marginTop: 4 },
	openRow: { alignItems: 'center', gap: 4 },
	openLabel: { fontWeight: '800', fontSize: 12 },
	otpBanner: {
		backgroundColor: colors.yellow[50],
		borderRadius: 12,
		padding: spacing.sm,
		marginBottom: spacing.sm,
	},
	otpText: { fontWeight: '800', color: colors.yellow[600] },
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
	hint: { color: brand.primary, fontWeight: '600', marginTop: 4 },
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
