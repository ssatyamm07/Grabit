import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/src/store/auth.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces } from '@/src/theme/tokens';

export default function ProfileScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);

	return (
		<View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
			<Text style={styles.title}>Profile</Text>

			<View style={styles.card}>
				<View style={styles.avatar}>
					<Ionicons name="person" size={28} color={brand.primary} />
				</View>
				<View style={{ flex: 1 }}>
					<Text style={styles.name}>{user?.name || 'Grabit customer'}</Text>
					<Text style={styles.meta}>+91 {user?.phone}</Text>
					<Text style={styles.role}>{user?.role}</Text>
				</View>
			</View>

			<View style={styles.info}>
				<Text style={styles.infoTitle}>About Grabit</Text>
				<Text style={styles.infoBody}>
					Asset-light local commerce — shop neighbourhood stores without the platform owning inventory.
				</Text>
			</View>

			<Button
				title="Log out"
				variant="secondary"
				onPress={async () => {
					await logout();
					router.replace('/(auth)/login');
				}}
				style={{ marginTop: 'auto', marginBottom: spacing.lg }}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg, paddingHorizontal: spacing.md },
	title: { fontSize: 28, fontWeight: '800', color: brand.text, marginBottom: spacing.md },
	card: {
		...surfaces.card,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		padding: spacing.md,
	},
	avatar: {
		width: 56,
		height: 56,
		borderRadius: 18,
		backgroundColor: colors.blue[50],
		alignItems: 'center',
		justifyContent: 'center',
	},
	name: { fontSize: 17, fontWeight: '800', color: brand.text },
	meta: { color: brand.textMuted, marginTop: 2 },
	role: {
		marginTop: 6,
		alignSelf: 'flex-start',
		backgroundColor: colors.green[50],
		color: colors.green[700],
		overflow: 'hidden',
		fontSize: 12,
		fontWeight: '700',
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 999,
		textTransform: 'capitalize',
	},
	info: {
		marginTop: spacing.lg,
		padding: spacing.md,
		borderRadius: 16,
		backgroundColor: colors.yellow[50],
		borderWidth: 1,
		borderColor: colors.yellow[100],
	},
	infoTitle: { fontWeight: '800', color: colors.yellow[600], marginBottom: 6 },
	infoBody: { color: brand.textMuted, lineHeight: 20 },
});
