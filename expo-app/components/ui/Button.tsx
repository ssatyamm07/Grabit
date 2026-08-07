import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	View,
	type PressableProps,
	type StyleProp,
	type ViewStyle,
} from 'react-native';

import { brand, colors } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

type Variant = 'primary' | 'accent' | 'secondary' | 'success';

type Props = Omit<PressableProps, 'style'> & {
	title: string;
	variant?: Variant;
	loading?: boolean;
	style?: StyleProp<ViewStyle>;
};

export function Button({
	title,
	variant = 'accent',
	loading = false,
	disabled,
	style,
	...props
}: Props) {
	const isDisabled = disabled || loading;
	const spinner =
		variant === 'secondary' || variant === 'accent' ? colors.neutral[900] : colors.neutral[0];

	return (
		<Pressable
			{...props}
			disabled={isDisabled}
			style={({ pressed }) => [
				styles.base,
				styles[variant],
				pressed && !isDisabled ? styles.pressed : null,
				isDisabled ? styles.disabled : null,
				style,
			]}
		>
			<View style={styles.content}>
				{loading ? <ActivityIndicator size="small" color={spinner} /> : null}
				<Text
					style={[
						styles.text,
						(variant === 'secondary' || variant === 'accent') && styles.textDark,
					]}
				>
					{title}
				</Text>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	base: {
		borderRadius: 14,
		paddingVertical: spacing.md,
		paddingHorizontal: spacing.lg,
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 52,
	},
	content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	primary: { backgroundColor: brand.primary },
	accent: { backgroundColor: brand.accent },
	success: { backgroundColor: brand.success },
	secondary: {
		backgroundColor: brand.surface,
		borderWidth: 1.5,
		borderColor: brand.border,
	},
	pressed: { opacity: 0.9 },
	disabled: { opacity: 0.55 },
	text: { color: colors.neutral[0], fontSize: 16, fontWeight: '700' },
	textDark: { color: colors.neutral[900] },
});
