import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';

import { queryClient } from '@/src/query/query-client';
import { useAuthStore } from '@/src/store/auth.store';
import { useCartStore } from '@/src/store/cart.store';
import { brand } from '@/src/theme/colors';

export default function RootLayout() {
	const hydrateAuth = useAuthStore((s) => s.hydrate);
	const hydrateCart = useCartStore((s) => s.hydrate);

	useEffect(() => {
		void Promise.all([hydrateAuth(), hydrateCart()]);
	}, [hydrateAuth, hydrateCart]);

	return (
		<GestureHandlerRootView style={styles.root}>
			<SafeAreaProvider>
				<QueryClientProvider client={queryClient}>
					<StatusBar style="light" />
					<Stack
						screenOptions={{
							headerShown: false,
							contentStyle: { backgroundColor: brand.bg },
						}}
					>
						<Stack.Screen name="index" />
						<Stack.Screen name="(auth)/login" />
						<Stack.Screen name="(customer)" />
						<Stack.Screen name="(vendor)/home" />
					</Stack>
				</QueryClientProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
});
