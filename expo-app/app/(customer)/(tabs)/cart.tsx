import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScalePressable } from '@/components/ui/ScalePressable';
import { formatPaise, newIdempotencyKey, placeOrder } from '@/src/api/services';
import { useCartStore } from '@/src/store/cart.store';
import { useToastStore } from '@/src/store/toast.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

const DELIVERY_FEE_PAISE = 2000;

export default function CartScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const lines = useCartStore((s) => s.lines);
	const setQty = useCartStore((s) => s.setQty);
	const clear = useCartStore((s) => s.clear);
	const subtotal = useCartStore((s) => s.subtotalPaise());
	const vendorId = useCartStore((s) => s.vendorId());
	const toast = useToastStore((s) => s.show);

	const orderMut = useMutation({
		mutationFn: async () => {
			if (!vendorId || !lines.length) throw new Error('Cart empty');
			return placeOrder({
				vendor_id: vendorId,
				items: lines.map((l) => ({ listing_id: l.listing_id, qty: l.qty })),
				idempotencyKey: newIdempotencyKey(),
			});
		},
		onSuccess: (res) => {
			clear();
			toast(`Order #${res.order.id} placed`, 'success');
			router.push('/(customer)/(tabs)/orders');
		},
		onError: (err: Error) => Alert.alert('Order failed', err.message),
	});

	if (!lines.length) {
		return (
			<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
				<Text style={styles.title}>Cart</Text>
				<EmptyState
					icon={<Ionicons name="cart-outline" size={40} color={brand.primary} />}
					title="Your cart is empty"
					subtitle="Browse neighbourhood stores and tap ADD on products."
					action={
						<Button title="Browse stores" onPress={() => router.push('/(customer)/(tabs)')} />
					}
				/>
			</View>
		);
	}

	const total = subtotal + DELIVERY_FEE_PAISE;

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<Text style={styles.title}>Cart</Text>
			<Text style={styles.sub}>
				{lines[0]?.vendor_name} · {lines.reduce((n, l) => n + l.qty, 0)} items
			</Text>

			<FlatList
				data={lines}
				keyExtractor={(item) => String(item.listing_id)}
				contentContainerStyle={{ paddingBottom: 160 }}
				renderItem={({ item }) => (
					<View style={styles.line}>
						<View style={{ flex: 1 }}>
							<Text style={styles.lineName}>{item.name}</Text>
							<Text style={styles.lineMeta}>{formatPaise(item.price_paise)} each</Text>
						</View>
						<View style={styles.stepper}>
							<ScalePressable style={styles.stepBtn} onPress={() => setQty(item.listing_id, item.qty - 1)}>
								<Text style={styles.stepText}>−</Text>
							</ScalePressable>
							<Text style={styles.qty}>{item.qty}</Text>
							<ScalePressable style={styles.stepBtn} onPress={() => setQty(item.listing_id, item.qty + 1)}>
								<Text style={styles.stepText}>+</Text>
							</ScalePressable>
						</View>
					</View>
				)}
			/>

			<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
				<View style={styles.summary}>
					<Text style={styles.sumRow}>Subtotal · {formatPaise(subtotal)}</Text>
					<Text style={styles.sumRow}>Delivery · {formatPaise(DELIVERY_FEE_PAISE)}</Text>
					<Text style={styles.grand}>Total · {formatPaise(total)}</Text>
					<Text style={styles.cod}>Pay on delivery (COD)</Text>
				</View>
				<Button
					title="Place order"
					loading={orderMut.isPending}
					onPress={() => orderMut.mutate()}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	title: { fontSize: 28, fontWeight: '800', color: brand.text },
	sub: { color: brand.textMuted, marginTop: 4, marginBottom: spacing.md },
	line: {
		...surfaces.card,
		flexDirection: 'row',
		alignItems: 'center',
		padding: spacing.md,
		marginBottom: spacing.sm,
		gap: spacing.md,
	},
	lineName: { fontWeight: '700', fontSize: 15, color: brand.text },
	lineMeta: { color: brand.textMuted, marginTop: 2, fontSize: 13 },
	stepper: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		backgroundColor: colors.blue[50],
		borderRadius: 12,
		paddingHorizontal: 8,
		paddingVertical: 6,
	},
	stepBtn: {
		width: 28,
		height: 28,
		borderRadius: 8,
		backgroundColor: brand.accent,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stepText: { fontWeight: '800', fontSize: 16, color: colors.neutral[900] },
	qty: { fontWeight: '800', minWidth: 16, textAlign: 'center' },
	footer: {
		position: 'absolute',
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: colors.neutral[0],
		borderTopWidth: 1,
		borderTopColor: brand.border,
		padding: spacing.md,
		gap: spacing.sm,
	},
	summary: { gap: 2 },
	sumRow: { color: brand.textMuted, fontSize: 13 },
	grand: { fontSize: 18, fontWeight: '800', color: brand.text, marginTop: 4 },
	cod: { color: brand.success, fontWeight: '600', fontSize: 12, marginTop: 2 },
});
