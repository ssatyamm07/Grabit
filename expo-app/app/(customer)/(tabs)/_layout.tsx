import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CustomerTabBar, type CustomerTabBarProps } from '@/components/customer/CustomerTabBar';
import { useCartStore } from '@/src/store/cart.store';
import { brand } from '@/src/theme/colors';

export default function CustomerTabsLayout() {
	const qty = useCartStore((s) => s.totalQuantity());

	return (
		<Tabs
			tabBar={(props) => <CustomerTabBar {...(props as unknown as CustomerTabBarProps)} />}
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: brand.primary,
				tabBarInactiveTintColor: brand.textMuted,
			}}
		>
			<Tabs.Screen
				name="index"
				options={{
					title: 'Home',
					tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="services"
				options={{
					title: 'Services',
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="construct-outline" size={size} color={color} />
					),
				}}
			/>
			<Tabs.Screen
				name="cart"
				options={{
					title: 'Cart',
					tabBarBadge: qty > 0 ? qty : undefined,
					tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" size={size} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="orders"
				options={{
					title: 'Orders',
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="receipt-outline" size={size} color={color} />
					),
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: 'Profile',
					tabBarIcon: ({ color, size }) => (
						<Ionicons name="person-outline" size={size} color={color} />
					),
				}}
			/>
		</Tabs>
	);
}
