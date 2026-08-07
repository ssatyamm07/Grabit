import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScalePressable } from '@/components/ui/ScalePressable';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

type Props = {
	name: string;
	vendorType: string;
	listingCount: number | string;
	onPress: () => void;
};

export function VendorCard({ name, vendorType, listingCount, onPress }: Props) {
	return (
		<ScalePressable style={styles.card} onPress={onPress}>
			<View style={styles.avatar}>
				<Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
			</View>
			<View style={{ flex: 1 }}>
				<Text style={styles.name} numberOfLines={1}>
					{name}
				</Text>
				<Text style={styles.meta}>
					{vendorType} · {listingCount} items
				</Text>
				<View style={styles.etaRow}>
					<Ionicons name="bicycle-outline" size={14} color={brand.success} />
					<Text style={styles.eta}>Local delivery</Text>
				</View>
			</View>
			<Ionicons name="chevron-forward" size={18} color={brand.textMuted} />
		</ScalePressable>
	);
}

const styles = StyleSheet.create({
	card: {
		...surfaces.card,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		padding: spacing.md,
		marginBottom: spacing.sm,
	},
	avatar: {
		width: 52,
		height: 52,
		borderRadius: 16,
		backgroundColor: colors.blue[50],
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.blue[100],
	},
	avatarText: { fontSize: 20, fontWeight: '800', color: brand.primary },
	name: { fontSize: 16, fontWeight: '700', color: brand.text },
	meta: { marginTop: 2, fontSize: 13, color: brand.textMuted },
	etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
	eta: { fontSize: 12, fontWeight: '600', color: brand.success },
});
