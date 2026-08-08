import crypto from 'crypto';

export function razorpayConfigured() {
	return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

export function verifyCheckoutSignature({
	razorpay_order_id,
	razorpay_payment_id,
	razorpay_signature,
	secret = process.env.RAZORPAY_KEY_SECRET,
}) {
	if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !secret) {
		return false;
	}
	const body = `${razorpay_order_id}|${razorpay_payment_id}`;
	const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
	try {
		return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
	} catch {
		return false;
	}
}

export function verifyWebhookSignature(rawBody, signature, secret) {
	const key = secret || process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
	if (!key || !signature) return false;
	const expected = crypto.createHmac('sha256', key).update(rawBody).digest('hex');
	try {
		return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
	} catch {
		return false;
	}
}

export async function createRazorpayOrder({ amountPaise, receipt, notes }) {
	const auth = Buffer.from(
		`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
	).toString('base64');
	const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			amount: amountPaise,
			currency: 'INR',
			receipt,
			notes: notes || {},
		}),
	});
	const rpData = await rpRes.json().catch(() => ({}));
	return { ok: rpRes.ok, status: rpRes.status, data: rpData };
}
