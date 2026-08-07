import { StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/ScalePressable';
import { formatPaise } from '@/src/api/services';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

type Props = {
	name: string;
	brandName?: string | null;
	unit?: string | null;
	pricePaise: number;
	availableQty: number;
	onAdd: () => void;
};

export function ProductCard({ name, brandName, unit, pricePaise, availableQty, onAdd }: Props) {
	const out = availableQty < 1;

	return (
		<View style={[styles.card, out && styles.out]}>
			<View style={styles.image}>
				<Text style={styles.initial}>{name.slice(0, 1)}</Text>
				{!out ? (
					<ScalePressable style={styles.addBtn} onPress={onAdd}>
						<Text style={styles.addText}>ADD</Text>
					</ScalePressable>
				) : (
					<View style={styles.soldOut}>
						<Text style={styles.soldText}>Out</Text>
					</View>
				)}
			</View>
			<Text style={styles.name} numberOfLines={2}>
				{name}
			</Text>
			<Text style={styles.meta} numberOfLines={1}>
				{[brandName, unit].filter(Boolean).join(' · ') || ' '}
			</Text>
			<Text style={styles.price}>{formatPaise(pricePaise)}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	card: {
		...surfaces.card,
		flex: 1,
		padding: spacing.sm,
		minHeight: 200,
	},
	out: { opacity: 0.55 },
	image: {
		height: 110,
		borderRadius: 12,
		backgroundColor: colors.green[50],
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: spacing.sm,
		overflow: 'hidden',
	},
	initial: { fontSize: 36, fontWeight: '800', color: colors.green[300] },
	addBtn: {
		position: 'absolute',
		right: 8,
		bottom: 8,
		backgroundColor: brand.accent,
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	addText: { fontWeight: '800', fontSize: 12, color: colors.neutral[900] },
	soldOut: {
		position: 'absolute',
		right: 8,
		bottom: 8,
		backgroundColor: colors.neutral[200],
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	soldText: { fontWeight: '700', fontSize: 12, color: brand.textMuted },
	name: { fontSize: 14, fontWeight: '700', color: brand.text, minHeight: 36 },
	meta: { fontSize: 12, color: brand.textMuted, marginTop: 2 },
	price: { marginTop: 6, fontSize: 15, fontWeight: '800', color: brand.primary },
});
