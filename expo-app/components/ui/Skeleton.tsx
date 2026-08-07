import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '@/src/theme/colors';

type Props = {
	width?: number | `${number}%`;
	height?: number;
	borderRadius?: number;
	style?: ViewStyle;
};

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
	const opacity = useRef(new Animated.Value(0.35)).current;

	useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
				Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
			])
		);
		loop.start();
		return () => loop.stop();
	}, [opacity]);

	return (
		<Animated.View
			style={[
				styles.base,
				{ width, height, borderRadius, opacity },
				style,
			]}
		/>
	);
}

const styles = StyleSheet.create({
	base: { backgroundColor: colors.neutral[200] },
});
