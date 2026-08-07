import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { brand } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

type Props = {
	icon?: ReactNode;
	title: string;
	subtitle: string;
	action?: ReactNode;
};

export function EmptyState({ icon, title, subtitle, action }: Props) {
	return (
		<View style={styles.container}>
			{icon ? <View style={styles.iconWrap}>{icon}</View> : null}
			<Text style={styles.title}>{title}</Text>
			<Text style={styles.subtitle}>{subtitle}</Text>
			{action ? <View style={styles.action}>{action}</View> : null}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: spacing.lg,
		minHeight: 320,
	},
	iconWrap: {
		width: 88,
		height: 88,
		borderRadius: 44,
		backgroundColor: brand.bg,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: spacing.md,
	},
	title: {
		fontSize: 20,
		fontWeight: '700',
		color: brand.text,
		textAlign: 'center',
	},
	subtitle: {
		marginTop: spacing.sm,
		fontSize: 14,
		color: brand.textMuted,
		textAlign: 'center',
		lineHeight: 20,
	},
	action: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
