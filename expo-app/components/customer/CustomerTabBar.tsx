import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, colors } from '@/src/theme/colors';

type TabBarRoute = { key: string; name: string };

export type CustomerTabBarProps = {
	state: { index: number; routes: TabBarRoute[] };
	descriptors: Record<string, { options: Record<string, unknown> }>;
	navigation: {
		emit: (e: { type: string; target: string; canPreventDefault?: boolean }) => {
			defaultPrevented: boolean;
		};
		navigate: (name: string) => void;
	};
};

export function CustomerTabBar({ state, descriptors, navigation }: CustomerTabBarProps) {
	const insets = useSafeAreaInsets();

	return (
		<View
			style={[
				styles.container,
				{ paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 4) },
			]}
		>
			<View style={styles.topBorder} />
			<View style={styles.row}>
				{state.routes.map((route, index) => {
					const options = descriptors[route.key]?.options ?? {};
					const focused = state.index === index;
					const color = focused ? brand.primary : brand.textMuted;
					const title = typeof options.title === 'string' ? options.title : route.name;
					const tabBarIcon = options.tabBarIcon as
						| ((p: { focused: boolean; color: string; size: number }) => React.ReactNode)
						| undefined;
					const badge = options.tabBarBadge as number | string | undefined;

					return (
						<Pressable
							key={route.key}
							style={styles.tab}
							onPress={() => {
								const event = navigation.emit({
									type: 'tabPress',
									target: route.key,
									canPreventDefault: true,
								});
								if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
							}}
						>
							{focused ? <View style={styles.indicator} /> : <View style={styles.indicatorSpacer} />}
							<View>
								{tabBarIcon?.({ focused, color, size: 22 })}
								{badge != null ? (
									<View style={styles.badge}>
										<Text style={styles.badgeText}>{badge}</Text>
									</View>
								) : null}
							</View>
							<Text style={[styles.label, { color }]}>{title}</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		backgroundColor: colors.neutral[0],
		borderTopWidth: 0,
	},
	topBorder: { height: StyleSheet.hairlineWidth, backgroundColor: colors.neutral[200] },
	row: { flexDirection: 'row' },
	tab: {
		flex: 1,
		alignItems: 'center',
		paddingTop: 6,
		paddingBottom: 4,
		gap: 2,
	},
	indicator: {
		width: 28,
		height: 3,
		borderRadius: 2,
		backgroundColor: brand.primary,
		marginBottom: 4,
	},
	indicatorSpacer: { height: 7 },
	label: { fontSize: 11, fontWeight: '600' },
	badge: {
		position: 'absolute',
		top: -4,
		right: -10,
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
