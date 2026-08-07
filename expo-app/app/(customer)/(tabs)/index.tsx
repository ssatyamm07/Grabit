import { useMemo, useState } from 'react';
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { CustomerHeader } from '@/components/customer/CustomerHeader';
import { ProductCard } from '@/components/home/ProductCard';
import { VendorCard } from '@/components/home/VendorCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { getStorefront, listVendors } from '@/src/api/services';
import { useCartStore } from '@/src/store/cart.store';
import { useToastStore } from '@/src/store/toast.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

const CHIPS = ['All', 'Grocery', 'Dairy', 'Bakery', 'Stationery'];

export default function CustomerHome() {
	const [vendorId, setVendorId] = useState<number | null>(null);
	const [vendorName, setVendorName] = useState('');
	const [chip, setChip] = useState('All');
	const add = useCartStore((s) => s.add);
	const toast = useToastStore((s) => s.show);

	const vendorsQ = useQuery({ queryKey: ['vendors'], queryFn: listVendors });
	const storeQ = useQuery({
		queryKey: ['storefront', vendorId],
		queryFn: () => getStorefront(vendorId!),
		enabled: vendorId != null,
	});

	const vendors = useMemo(() => {
		const rows = vendorsQ.data || [];
		if (chip === 'All') return rows;
		return rows.filter((v) => v.vendor_type.toLowerCase().includes(chip.toLowerCase()));
	}, [vendorsQ.data, chip]);

	const productPairs = useMemo(() => {
		const items = storeQ.data || [];
		const pairs: Array<typeof items> = [];
		for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
		return pairs;
	}, [storeQ.data]);

	return (
		<View style={styles.screen}>
			<CustomerHeader locationLabel="Demo Town" />

			{vendorId == null ? (
				<FlatList
					data={vendors}
					keyExtractor={(item) => String(item.id)}
					contentContainerStyle={{ paddingBottom: 32 }}
					ListHeaderComponent={
						<View>
							<LinearGradient
								colors={[colors.blue[600], colors.blue[500], colors.green[500]]}
								start={{ x: 0, y: 0 }}
								end={{ x: 1, y: 1 }}
								style={styles.hero}
							>
								<Text style={styles.heroEyebrow}>Neighbourhood commerce</Text>
								<Text style={styles.heroTitle}>Order from shops near you</Text>
								<Text style={styles.heroSub}>
									Kirana, dairy, stationery — one app, local delivery
								</Text>
							</LinearGradient>

							<FlatList
								horizontal
								showsHorizontalScrollIndicator={false}
								data={CHIPS}
								keyExtractor={(c) => c}
								contentContainerStyle={styles.chips}
								renderItem={({ item }) => (
									<Pressable
										style={[styles.chip, chip === item && styles.chipActive]}
										onPress={() => setChip(item)}
									>
										<Text style={[styles.chipText, chip === item && styles.chipTextActive]}>
											{item}
										</Text>
									</Pressable>
								)}
							/>

							<Text style={styles.section}>Near you</Text>
						</View>
					}
					ListEmptyComponent={
						vendorsQ.isFetching ? (
							<View style={{ padding: spacing.md, gap: 10 }}>
								<Skeleton height={76} borderRadius={14} />
								<Skeleton height={76} borderRadius={14} />
								<Skeleton height={76} borderRadius={14} />
							</View>
						) : (
							<EmptyState
								icon={<Ionicons name="storefront-outline" size={40} color={brand.primary} />}
								title="No stores yet"
								subtitle="Seed the backend to load Ravi Kirana Store."
							/>
						)
					}
					renderItem={({ item }) => (
						<View style={{ paddingHorizontal: spacing.md }}>
							<VendorCard
								name={item.business_name}
								vendorType={item.vendor_type}
								listingCount={item.listing_count}
								onPress={() => {
									setVendorId(item.id);
									setVendorName(item.business_name);
								}}
							/>
						</View>
					)}
					refreshing={vendorsQ.isFetching}
					onRefresh={() => void vendorsQ.refetch()}
				/>
			) : (
				<FlatList
					data={productPairs}
					keyExtractor={(_, i) => `row-${i}`}
					contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
					ListHeaderComponent={
						<View style={{ marginBottom: spacing.md }}>
							<Pressable
								onPress={() => setVendorId(null)}
								style={styles.backRow}
							>
								<Ionicons name="arrow-back" size={18} color={brand.primary} />
								<Text style={styles.backText}>All stores</Text>
							</Pressable>
							<Text style={styles.storeTitle}>{vendorName}</Text>
							<Text style={styles.storeMeta}>Tap ADD to build your cart</Text>
						</View>
					}
					ListEmptyComponent={
						storeQ.isFetching ? (
							<ActivityIndicator color={brand.primary} style={{ marginTop: 24 }} />
						) : (
							<EmptyState
								title="Empty shelf"
								subtitle="This vendor has no active listings."
							/>
						)
					}
					renderItem={({ item }) => (
						<View style={styles.gridRow}>
							{item.map((p) => (
								<View key={p.listing_id} style={{ flex: 1 }}>
									<ProductCard
										name={p.name}
										brandName={p.brand}
										unit={p.unit_label}
										pricePaise={p.price_paise}
										availableQty={p.available_qty}
										onAdd={() => {
											add({
												listing_id: p.listing_id,
												vendor_id: vendorId,
												vendor_name: vendorName,
												name: p.name,
												price_paise: p.price_paise,
												available_qty: p.available_qty,
											});
											toast(`Added ${p.name}`, 'success');
										}}
									/>
								</View>
							))}
							{item.length === 1 ? <View style={{ flex: 1 }} /> : null}
						</View>
					)}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg },
	hero: {
		marginHorizontal: spacing.md,
		marginTop: spacing.md,
		borderRadius: 20,
		padding: spacing.lg,
		overflow: 'hidden',
	},
	heroEyebrow: {
		color: colors.yellow[300],
		fontWeight: '700',
		fontSize: 12,
		textTransform: 'uppercase',
		letterSpacing: 0.8,
	},
	heroTitle: {
		marginTop: 8,
		color: colors.neutral[0],
		fontSize: 24,
		fontWeight: '800',
		lineHeight: 30,
	},
	heroSub: { marginTop: 8, color: colors.blue[100], fontSize: 14, lineHeight: 20 },
	chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 8 },
	chip: {
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 999,
		backgroundColor: colors.neutral[0],
		borderWidth: 1,
		borderColor: brand.border,
		marginRight: 8,
	},
	chipActive: { backgroundColor: brand.primary, borderColor: brand.primary },
	chipText: { fontWeight: '700', color: brand.textMuted, fontSize: 13 },
	chipTextActive: { color: colors.neutral[0] },
	section: {
		paddingHorizontal: spacing.md,
		marginBottom: spacing.sm,
		fontSize: 18,
		fontWeight: '800',
		color: brand.text,
	},
	backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
	backText: { color: brand.primary, fontWeight: '700' },
	storeTitle: { fontSize: 22, fontWeight: '800', color: brand.text },
	storeMeta: { color: brand.textMuted, marginTop: 4 },
	gridRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
});
