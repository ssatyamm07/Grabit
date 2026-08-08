import { Redirect, Stack } from 'expo-router';

import { ToastHost } from '@/components/ui/ToastHost';
import { useAuthStore } from '@/src/store/auth.store';
import { brand } from '@/src/theme/colors';

export default function CustomerLayout() {
	const hydrated = useAuthStore((s) => s.hydrated);
	const token = useAuthStore((s) => s.accessToken);
	const role = useAuthStore((s) => s.user?.role);

	if (!hydrated) return null;
	if (!token) return <Redirect href="/(auth)/login" />;
	if (role === 'vendor') return <Redirect href="/(vendor)/home" />;

	return (
		<>
			<ToastHost />
			<Stack
				screenOptions={{
					headerShown: false,
					contentStyle: { backgroundColor: brand.bg },
				}}
			>
				<Stack.Screen name="(tabs)" />
				<Stack.Screen name="order/[id]" />
			</Stack>
		</>
	);
}
