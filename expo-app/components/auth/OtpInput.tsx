import { useRef } from 'react';
import {
	StyleSheet,
	TextInput,
	View,
	type NativeSyntheticEvent,
	type TextInputKeyPressEventData,
} from 'react-native';

import { brand, colors } from '@/src/theme/colors';
import { spacing } from '@/src/theme/tokens';

type Props = {
	value: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
};

export function OtpInput({ value, onChange, disabled }: Props) {
	const refs = useRef<Array<TextInput | null>>([]);

	function updateDigit(index: number, digit: string) {
		const next = [...value];
		next[index] = digit.replace(/\D/g, '').slice(-1);
		onChange(next);
		if (digit && index < value.length - 1) refs.current[index + 1]?.focus();
	}

	function onKeyPress(index: number, event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
		if (event.nativeEvent.key === 'Backspace' && !value[index] && index > 0) {
			refs.current[index - 1]?.focus();
		}
	}

	return (
		<View style={styles.row}>
			{value.map((digit, index) => (
				<TextInput
					key={index}
					ref={(ref) => {
						refs.current[index] = ref;
					}}
					value={digit}
					onChangeText={(text) => updateDigit(index, text)}
					onKeyPress={(e) => onKeyPress(index, e)}
					keyboardType="number-pad"
					maxLength={1}
					editable={!disabled}
					style={[styles.box, digit ? styles.filled : null]}
					textAlign="center"
				/>
			))}
		</View>
	);
}

export function createEmptyOtp(length = 6) {
	return Array.from({ length }, () => '');
}

const styles = StyleSheet.create({
	row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
	box: {
		flex: 1,
		maxWidth: 48,
		height: 56,
		borderWidth: 2,
		borderColor: brand.border,
		borderRadius: 12,
		fontSize: 22,
		fontWeight: '700',
		color: brand.text,
		backgroundColor: colors.neutral[50],
	},
	filled: { borderColor: brand.primary, backgroundColor: colors.blue[50] },
});
