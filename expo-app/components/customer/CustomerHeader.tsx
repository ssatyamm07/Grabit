import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ScalePressable } from '@/components/ui/ScalePressable';
import { useCartStore } from '@/src/store/cart.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

type Props = {
	locationLabel?: string;
	onLocationPress?: () => void;
};

export function CustomerHeader({ locationLabel = 'Demo Town', onLocationPress }: Props) {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const qty = useCartStore((s) => s.totalQuantity());

	return (
		<View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
			<View style={styles.row}>
				<Text style={styles.logo}>Grabit</Text>

				<ScalePressable style={styles.location} onPress={onLocationPress}>
					<Text style={styles.deliver}>Deliver to</Text>
					<View style={styles.locRow}>
						<Text style={styles.locText} numberOfLines={1}>
							{locationLabel}
						</Text>
						<Ionicons name="chevron-down" size={14} color={colors.yellow[300]} />
					</View>
				</ScalePressable>

				<ScalePressable style={styles.iconBtn} onPress={() => router.push('/(customer)/(tabs)/cart')}>
					<Ionicons name="cart-outline" size={22} color={colors.neutral[0]} />
					{qty > 0 ? (
						<View style={styles.badge}>
							<Text style={styles.badgeText}>{qty > 99 ? '99+' : qty}</Text>
						</View>
					) : null}
				</ScalePressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {
		backgroundColor: colors.blue[700],
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.md,
	},
	row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	logo: {
		fontSize: 22,
		fontWeight: '800',
		color: colors.neutral[0],
		letterSpacing: -0.4,
	},
	location: { flex: 1 },
	deliver: { color: colors.blue[100], fontSize: 11, fontWeight: '600' },
	locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
	locText: { color: colors.neutral[0], fontWeight: '700', fontSize: 14, maxWidth: 160 },
	iconBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: 'rgba(255,255,255,0.12)',
	},
	badge: {
		position: 'absolute',
		top: 2,
		right: 2,
		minWidth: 16,
		height: 16,
		borderRadius: 8,
		backgroundColor: brand.accent,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 3,
	},
	badgeText: { fontSize: 10, fontWeight: '800', color: colors.neutral[900] },
});
