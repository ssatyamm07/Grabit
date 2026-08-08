import crypto from 'crypto';

export function hashOtp(otp) {
	return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

export function generateDeliveryOtp() {
	return String(Math.floor(100000 + Math.random() * 900000));
}

export function deliveryOtpExpiresAt(ttlMs = 24 * 60 * 60_000) {
	return new Date(Date.now() + ttlMs);
}

/**
 * Resolve fulfillment_mode for an order from body or vendor default.
 * @returns {'self'|'partner'}
 */
export function resolveFulfillmentMode(requested, vendorDefault = 'either') {
	const req = requested ? String(requested) : null;
	if (req === 'self' || req === 'partner') {
		if (vendorDefault === 'self' && req !== 'self') {
			const err = new Error('Vendor only supports self-delivery');
			err.code = 'FULFILLMENT_MODE';
			throw err;
		}
		if (vendorDefault === 'partner' && req !== 'partner') {
			const err = new Error('Vendor only supports partner delivery');
			err.code = 'FULFILLMENT_MODE';
			throw err;
		}
		return req;
	}
	if (vendorDefault === 'self') return 'self';
	if (vendorDefault === 'partner') return 'partner';
	return 'self'; // either → default self for pilot
}
