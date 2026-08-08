import { Stack } from 'expo-router';

import { ToastHost } from '@/components/ui/ToastHost';
import { brand } from '@/src/theme/colors';

export default function AdminLayout() {
	return (
		<>
			<ToastHost />
			<Stack
				screenOptions={{
					headerShown: false,
					contentStyle: { backgroundColor: brand.bg },
				}}
			>
				<Stack.Screen name="home" />
			</Stack>
		</>
	);
}
