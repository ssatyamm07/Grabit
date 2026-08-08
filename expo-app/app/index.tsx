import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '@/src/store/auth.store';
import { brand } from '@/src/theme/colors';

export default function Index() {
	const hydrated = useAuthStore((s) => s.hydrated);
	const token = useAuthStore((s) => s.accessToken);
	const role = useAuthStore((s) => s.user?.role);

	if (!hydrated) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.bg }}>
				<ActivityIndicator color={brand.primary} size="large" />
			</View>
		);
	}

	if (!token) return <Redirect href="/(auth)/login" />;
	if (role === 'vendor') return <Redirect href="/(vendor)/home" />;
	if (role && ['super_admin', 'regional_admin', 'support', 'field_agent'].includes(role)) {
		return <Redirect href={'/(admin)/home' as never} />;
	}
	return <Redirect href="/(customer)/(tabs)" />;
}
