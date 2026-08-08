import { useMemo, useState } from 'react';
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import {
	createServiceBooking,
	formatPaise,
	listMasterServices,
	listMyBookings,
	listVendorServices,
	listVendors,
	newIdempotencyKey,
	unifiedSearch,
} from '@/src/api/services';
import { useToastStore } from '@/src/store/toast.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

export default function ServicesScreen() {
	const insets = useSafeAreaInsets();
	const toast = useToastStore((s) => s.show);
	const qc = useQueryClient();
	const [q, setQ] = useState('');
	const [vendorId, setVendorId] = useState<number | null>(null);
	const [vendorName, setVendorName] = useState('');

	const masterQ = useQuery({ queryKey: ['master-services'], queryFn: listMasterServices });
	const vendorsQ = useQuery({ queryKey: ['vendors'], queryFn: () => listVendors() });
	const vendorSvcQ = useQuery({
		queryKey: ['vendor-services', vendorId],
		queryFn: () => listVendorServices(vendorId!),
		enabled: vendorId != null,
	});
	const bookingsQ = useQuery({ queryKey: ['my-bookings'], queryFn: listMyBookings });
	const searchQ = useQuery({
		queryKey: ['service-search', q],
		queryFn: () => unifiedSearch(q),
		enabled: q.trim().length >= 2,
	});

	const bookM = useMutation({
		mutationFn: (vendor_service_id: number) => {
			const start = new Date();
			start.setHours(start.getHours() + 2, 0, 0, 0);
			return createServiceBooking({
				vendor_service_id,
				scheduled_start: start.toISOString(),
				idempotencyKey: newIdempotencyKey(),
			});
		},
		onSuccess: (data) => {
			toast(`Booking #${data.booking.id} requested`, 'success');
			void qc.invalidateQueries({ queryKey: ['my-bookings'] });
		},
		onError: (err: Error) => toast(err.message || 'Booking failed', 'error'),
	});

	const serviceVendors = useMemo(() => {
		const rows = vendorsQ.data || [];
		return rows.filter((v) => /service|repair|ac|plumb|electr/i.test(v.vendor_type + v.business_name));
	}, [vendorsQ.data]);

	const displayVendors = serviceVendors.length ? serviceVendors : vendorsQ.data || [];

	type BrowseRow =
		| {
				kind: 'vendor';
				id: number;
				business_name: string;
				vendor_type: string;
				listing_count: string | number;
				distance_m?: number;
		  }
		| {
				kind: 'service';
				id: number;
				title: string;
				price_paise: number;
				duration_minutes: number;
				vendor_id: number;
				business_name: string;
		  };

	const browseRows: BrowseRow[] =
		q.trim().length >= 2
			? (searchQ.data?.services || []).map((s) => ({ kind: 'service' as const, ...s }))
			: displayVendors.map((v) => ({ kind: 'vendor' as const, ...v }));

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<Text style={styles.title}>Services</Text>
			<Text style={styles.sub}>Book AC repair, plumbing, and local help</Text>

			<View style={styles.searchRow}>
				<Ionicons name="search" size={18} color={brand.textMuted} />
				<TextInput
					style={styles.search}
					placeholder="Search services…"
					placeholderTextColor={brand.textMuted}
					value={q}
					onChangeText={setQ}
					autoCapitalize="none"
				/>
			</View>

			{vendorId == null ? (
				<FlatList
					data={browseRows}
					keyExtractor={(item) =>
						item.kind === 'vendor' ? `v-${item.id}` : `s-${item.id}`
					}
					contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
					ListHeaderComponent={
						<View style={{ marginBottom: spacing.md }}>
							<Text style={styles.section}>Categories</Text>
							<FlatList
								horizontal
								data={masterQ.data || []}
								keyExtractor={(item) => String(item.id)}
								showsHorizontalScrollIndicator={false}
								ListEmptyComponent={
									masterQ.isFetching ? (
										<ActivityIndicator color={brand.primary} />
									) : (
										<Text style={styles.muted}>No master services seeded</Text>
									)
								}
								renderItem={({ item }) => (
									<View style={styles.catChip}>
										<Text style={styles.catText}>{item.name}</Text>
										{item.category ? (
											<Text style={styles.catMeta}>{item.category}</Text>
										) : null}
									</View>
								)}
							/>
							<Text style={[styles.section, { marginTop: spacing.md }]}>
								{q.trim().length >= 2 ? 'Matches' : 'Providers'}
							</Text>
						</View>
					}
					ListEmptyComponent={
						<EmptyState
							icon={<Ionicons name="construct-outline" size={40} color={brand.primary} />}
							title="No services yet"
							subtitle="Seed AC Service vendor or search after listings exist."
						/>
					}
					renderItem={({ item }) =>
						item.kind === 'vendor' ? (
							<Pressable
								style={styles.card}
								onPress={() => {
									setVendorId(item.id);
									setVendorName(item.business_name);
								}}
							>
								<Text style={styles.cardTitle}>{item.business_name}</Text>
								<Text style={styles.muted}>{item.vendor_type}</Text>
							</Pressable>
						) : (
							<View style={styles.card}>
								<Text style={styles.cardTitle}>{item.title}</Text>
								<Text style={styles.muted}>{item.business_name}</Text>
								<Text style={styles.price}>{formatPaise(item.price_paise)}</Text>
								<Button
									title={bookM.isPending ? 'Booking…' : 'Book in ~2h'}
									onPress={() => bookM.mutate(item.id)}
									disabled={bookM.isPending}
									loading={bookM.isPending}
								/>
							</View>
						)
					}
					ListFooterComponent={
						(bookingsQ.data || []).length ? (
							<View style={{ marginTop: spacing.lg }}>
								<Text style={styles.section}>Your bookings</Text>
								{(bookingsQ.data || []).slice(0, 5).map((b) => (
									<View key={String(b.id)} style={styles.bookingRow}>
										<Text style={styles.cardTitle}>#{String(b.id)}</Text>
										<Text style={styles.muted}>{String(b.status)}</Text>
									</View>
								))}
							</View>
						) : null
					}
				/>
			) : (
				<FlatList
					data={vendorSvcQ.data || []}
					keyExtractor={(item) => String(item.id)}
					contentContainerStyle={{ paddingBottom: 40 }}
					ListHeaderComponent={
						<View style={{ marginBottom: spacing.md }}>
							<Pressable
								style={styles.back}
								onPress={() => {
									setVendorId(null);
									setVendorName('');
								}}
							>
								<Ionicons name="arrow-back" size={18} color={brand.primary} />
								<Text style={styles.backText}>All providers</Text>
							</Pressable>
							<Text style={styles.storeTitle}>{vendorName}</Text>
						</View>
					}
					ListEmptyComponent={
						vendorSvcQ.isFetching ? (
							<ActivityIndicator color={brand.primary} />
						) : (
							<EmptyState title="No offerings" subtitle="This vendor has no active services." />
						)
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Text style={styles.cardTitle}>{item.title}</Text>
							<Text style={styles.muted}>{item.duration_minutes} min</Text>
							<Text style={styles.price}>{formatPaise(item.price_paise)}</Text>
							<Button
								title={bookM.isPending ? 'Booking…' : 'Book in ~2h'}
								onPress={() => bookM.mutate(item.id)}
								disabled={bookM.isPending}
								loading={bookM.isPending}
							/>
						</View>
					)}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	title: { fontSize: 28, fontWeight: '800', color: brand.text },
	sub: { color: brand.textMuted, marginBottom: spacing.md, marginTop: 4 },
	searchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: colors.neutral[0],
		borderWidth: 1,
		borderColor: brand.border,
		borderRadius: 12,
		paddingHorizontal: 12,
		marginBottom: spacing.md,
	},
	search: { flex: 1, paddingVertical: 12, color: brand.text, fontSize: 15 },
	section: { fontSize: 16, fontWeight: '800', color: brand.text, marginBottom: 8 },
	catChip: {
		...surfaces.card,
		padding: 12,
		marginRight: 8,
		minWidth: 120,
	},
	catText: { fontWeight: '700', color: brand.text },
	catMeta: { color: brand.textMuted, fontSize: 12, marginTop: 2 },
	card: { ...surfaces.card, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
	cardTitle: { fontWeight: '800', fontSize: 16, color: brand.text },
	muted: { color: brand.textMuted },
	price: { fontWeight: '800', color: brand.primary, fontSize: 16 },
	back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
	backText: { color: brand.primary, fontWeight: '700' },
	storeTitle: { fontSize: 22, fontWeight: '800', color: brand.text },
	bookingRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingVertical: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: brand.border,
	},
});
