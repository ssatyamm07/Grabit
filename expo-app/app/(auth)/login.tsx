import { useState } from 'react';
import {
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { createEmptyOtp, OtpInput } from '@/components/auth/OtpInput';
import { Button } from '@/components/ui/Button';
import { sendOtp, verifyOtp } from '@/src/api/services';
import { useAuthStore } from '@/src/store/auth.store';
import { brand, colors } from '@/src/theme/colors';
import { spacing, surfaces, typography } from '@/src/theme/tokens';

export default function LoginScreen() {
	const setSession = useAuthStore((s) => s.setSession);
	const [phone, setPhone] = useState('');
	const [otp, setOtp] = useState(createEmptyOtp());
	const [devOtp, setDevOtp] = useState<string | null>(null);
	const [step, setStep] = useState<'phone' | 'otp'>('phone');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSendOtp() {
		setError(null);
		setLoading(true);
		try {
			const res = await sendOtp(phone);
			if (res.dev_otp) setDevOtp(res.dev_otp);
			setOtp(createEmptyOtp());
			setStep('otp');
		} catch {
			setError('Could not send OTP. Check API URL / same Wi‑Fi as your Mac.');
		} finally {
			setLoading(false);
		}
	}

	async function onVerify() {
		setError(null);
		setLoading(true);
		try {
			const code = otp.join('');
			const res = await verifyOtp(phone, code);
			await setSession(res);
			if (res.user.role === 'vendor') router.replace('/(vendor)/home');
			else router.replace('/(customer)/(tabs)');
		} catch {
			setError('Invalid OTP');
		} finally {
			setLoading(false);
		}
	}

	return (
		<KeyboardAvoidingView
			style={styles.screen}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
		>
			<LinearGradient
				colors={[colors.blue[700], colors.blue[500], colors.green[600]]}
				start={{ x: 0, y: 0 }}
				end={{ x: 1, y: 1 }}
				style={styles.hero}
			>
				<Text style={styles.brand}>Grabit</Text>
				<Text style={styles.tagline}>Your neighbourhood, one app</Text>
				<View style={styles.swatchRow}>
					<View style={[styles.swatch, { backgroundColor: colors.blue[200] }]} />
					<View style={[styles.swatch, { backgroundColor: colors.yellow[400] }]} />
					<View style={[styles.swatch, { backgroundColor: colors.green[300] }]} />
				</View>
			</LinearGradient>

			<View style={styles.sheet}>
				<View style={styles.card}>
					<Text style={typography.h2}>{step === 'phone' ? 'Enter mobile' : 'Enter OTP'}</Text>
					<Text style={[typography.muted, { marginTop: spacing.sm }]}>
						{step === 'phone'
							? 'OTP login. Vendor demo: 9000000001 · Customer: any other number.'
							: `Code sent to +91 ${phone}`}
					</Text>

					{step === 'phone' ? (
						<TextInput
							style={styles.input}
							keyboardType="phone-pad"
							placeholder="10-digit mobile"
							placeholderTextColor={brand.textMuted}
							value={phone}
							onChangeText={setPhone}
							maxLength={10}
						/>
					) : (
						<View style={{ marginTop: spacing.lg }}>
							<OtpInput value={otp} onChange={setOtp} disabled={loading} />
						</View>
					)}

					{devOtp ? <Text style={styles.devHint}>Dev OTP: {devOtp}</Text> : null}
					{error ? <Text style={styles.error}>{error}</Text> : null}

					<Button
						style={{ marginTop: spacing.lg }}
						title={step === 'phone' ? 'Continue' : 'Verify & enter'}
						loading={loading}
						onPress={step === 'phone' ? onSendOtp : onVerify}
						disabled={step === 'phone' ? phone.length < 10 : otp.join('').length < 6}
					/>

					{step === 'otp' ? (
						<Button
							style={{ marginTop: spacing.sm }}
							title="Change number"
							variant="secondary"
							onPress={() => {
								setStep('phone');
								setDevOtp(null);
								setError(null);
							}}
						/>
					) : null}
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: brand.bg },
	hero: {
		paddingTop: 72,
		paddingHorizontal: spacing.lg,
		paddingBottom: 56,
		minHeight: '40%',
		justifyContent: 'flex-end',
	},
	brand: { ...typography.brand, color: colors.neutral[0], fontSize: 44 },
	tagline: {
		marginTop: spacing.sm,
		color: colors.yellow[300],
		fontSize: 17,
		fontWeight: '600',
	},
	swatchRow: { flexDirection: 'row', gap: 8, marginTop: spacing.lg },
	swatch: { width: 28, height: 6, borderRadius: 3 },
	sheet: {
		flex: 1,
		marginTop: -28,
		paddingHorizontal: spacing.md,
	},
	card: {
		...surfaces.elevated,
		padding: spacing.lg,
		flex: 1,
	},
	input: {
		marginTop: spacing.lg,
		borderWidth: 1.5,
		borderColor: brand.border,
		borderRadius: 14,
		paddingHorizontal: spacing.md,
		paddingVertical: 14,
		fontSize: 18,
		color: brand.text,
		backgroundColor: colors.neutral[50],
	},
	devHint: { marginTop: spacing.sm, color: brand.success, fontWeight: '700' },
	error: { marginTop: spacing.sm, color: colors.danger },
});
