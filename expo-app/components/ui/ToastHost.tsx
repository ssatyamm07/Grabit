import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore } from '@/src/store/toast.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

export function ToastHost() {
	const insets = useSafeAreaInsets();
	const toasts = useToastStore((s) => s.toasts);

	if (!toasts.length) return null;

	return (
		<View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
			{toasts.map((t) => (
				<View
					key={t.id}
					style={[
						styles.toast,
						t.tone === 'success' && styles.success,
						t.tone === 'error' && styles.error,
					]}
				>
					<Text style={styles.text}>{t.message}</Text>
				</View>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {
		position: 'absolute',
		left: spacing.md,
		right: spacing.md,
		zIndex: 100,
		gap: 8,
	},
	toast: {
		backgroundColor: colors.blue[700],
		borderRadius: 12,
		paddingHorizontal: spacing.md,
		paddingVertical: 12,
	},
	success: { backgroundColor: brand.success },
	error: { backgroundColor: colors.danger },
	text: { color: colors.neutral[0], fontWeight: '600', textAlign: 'center' },
});
