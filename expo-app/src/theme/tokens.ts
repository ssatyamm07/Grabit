import { brand, colors } from './colors';

export const spacing = {
	xs: 4,
	sm: 8,
	md: 16,
	lg: 24,
	xl: 32,
} as const;

export const radius = {
	sm: 10,
	md: 14,
	lg: 18,
	xl: 24,
	full: 999,
} as const;

export const surfaces = {
	card: {
		backgroundColor: brand.surface,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: brand.border,
		shadowColor: colors.blue[700],
		shadowOffset: { width: 0, height: 6 },
		shadowOpacity: 0.06,
		shadowRadius: 12,
		elevation: 2,
	},
	elevated: {
		backgroundColor: brand.surface,
		borderRadius: radius.lg,
		shadowColor: colors.blue[700],
		shadowOffset: { width: 0, height: 10 },
		shadowOpacity: 0.1,
		shadowRadius: 20,
		elevation: 6,
	},
} as const;

export const typography = {
	brand: {
		fontSize: 34,
		fontWeight: '800' as const,
		letterSpacing: -0.5,
		color: brand.primary,
	},
	h1: { fontSize: 26, fontWeight: '700' as const, color: brand.text },
	h2: { fontSize: 20, fontWeight: '700' as const, color: brand.text },
	body: { fontSize: 16, fontWeight: '400' as const, color: brand.text, lineHeight: 22 },
	muted: { fontSize: 14, fontWeight: '400' as const, color: brand.textMuted, lineHeight: 20 },
	label: {
		fontSize: 12,
		fontWeight: '700' as const,
		color: brand.textMuted,
		textTransform: 'uppercase' as const,
		letterSpacing: 0.6,
	},
};
