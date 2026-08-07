/** Grabit brand — blue, yellow, green */
export const colors = {
	blue: {
		50: '#E8F3FA',
		100: '#C5E0F2',
		200: '#8FC4E4',
		400: '#3A8FC8',
		500: '#1B6CA8',
		600: '#155A8C',
		700: '#0F476F',
	},
	yellow: {
		50: '#FFF9E6',
		100: '#FFEFBF',
		300: '#FFD95C',
		400: '#F5C518',
		500: '#E0B000',
		600: '#B38C00',
	},
	green: {
		50: '#E9F7EF',
		100: '#C6EBD5',
		300: '#5CB88A',
		400: '#3A9B6A',
		500: '#2E8B57',
		600: '#247046',
		700: '#1B5535',
	},
	neutral: {
		0: '#FFFFFF',
		50: '#F7FAFC',
		100: '#EDF2F7',
		200: '#E2E8F0',
		400: '#A0AEC0',
		600: '#4A5568',
		800: '#1A202C',
		900: '#0F172A',
	},
	danger: '#C53030',
} as const;

export const brand = {
	primary: colors.blue[500],
	primaryDark: colors.blue[700],
	accent: colors.yellow[400],
	accentDark: colors.yellow[600],
	success: colors.green[500],
	successDark: colors.green[700],
	bg: colors.neutral[50],
	surface: colors.neutral[0],
	text: colors.neutral[900],
	textMuted: colors.neutral[600],
	border: colors.neutral[200],
} as const;
