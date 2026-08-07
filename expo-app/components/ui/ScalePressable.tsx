import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = PressableProps & {
	style?: StyleProp<ViewStyle>;
	pressOpacity?: number;
};

/** Lightweight press feedback (Slade uses ScalePressable + Reanimated; we keep deps light). */
export function ScalePressable({ style, pressOpacity = 0.88, children, ...props }: Props) {
	return (
		<Pressable
			{...props}
			style={({ pressed }) => [style, pressed ? { opacity: pressOpacity } : null]}
		>
			{children}
		</Pressable>
	);
}
