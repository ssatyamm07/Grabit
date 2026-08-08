/**
 * Login OTP delivery via MSG91 (own-generated OTP, hashed locally).
 * Without MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID → dry-run (dev/test).
 */
export function otpDeliveryMode() {
	if (process.env.NODE_ENV === 'test') return 'dry_run';
	if (process.env.OTP_DRY_RUN === 'true') return 'dry_run';
	if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID) return 'msg91';
	return 'dry_run';
}

function normalizeIndianMobile(phone) {
	const digits = String(phone).replace(/\D/g, '');
	const last10 = digits.slice(-10);
	return `91${last10}`;
}

/**
 * @returns {{ mode: 'msg91'|'dry_run', ok: boolean, provider?: object, error?: string }}
 */
export async function deliverLoginOtp(phone, otp) {
	const mode = otpDeliveryMode();
	const mobile = normalizeIndianMobile(phone);

	if (mode === 'dry_run') {
		return { mode: 'dry_run', ok: true, provider: { mobile } };
	}

	const authKey = process.env.MSG91_AUTH_KEY;
	const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
	const expiryMin = Number(process.env.MSG91_OTP_EXPIRY_MIN || 10);

	try {
		const res = await fetch('https://control.msg91.com/api/v5/otp', {
			method: 'POST',
			headers: {
				authkey: authKey,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({
				template_id: templateId,
				mobile,
				otp: String(otp),
				otp_expiry: expiryMin,
			}),
		});
		const data = await res.json().catch(() => ({}));
		const ok = res.ok && (data.type === 'success' || data.message === 'OTP sent successfully');
		if (!ok) {
			return {
				mode: 'msg91',
				ok: false,
				provider: data,
				error: data.message || `MSG91 HTTP ${res.status}`,
			};
		}
		return { mode: 'msg91', ok: true, provider: data };
	} catch (err) {
		return { mode: 'msg91', ok: false, error: String(err.message || err) };
	}
}
