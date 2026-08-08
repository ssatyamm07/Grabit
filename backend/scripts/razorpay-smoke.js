#!/usr/bin/env node
/**
 * Razorpay signature smoke (offline) + optional live Orders API ping.
 * Offline always: node scripts/razorpay-smoke.js
 * Live create:    RAZORPAY_SMOKE_LIVE=1 node scripts/razorpay-smoke.js
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
	razorpayConfigured,
	verifyCheckoutSignature,
	verifyWebhookSignature,
	createRazorpayOrder,
} from '../src/services/razorpay.js';

dotenv.config();

const secret = process.env.RAZORPAY_KEY_SECRET || 'test_secret_for_smoke';
const orderId = 'order_smoke123';
const paymentId = 'pay_smoke456';
const body = `${orderId}|${paymentId}`;
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

const checkoutOk = verifyCheckoutSignature({
	razorpay_order_id: orderId,
	razorpay_payment_id: paymentId,
	razorpay_signature: sig,
	secret,
});
const webhookPayload = JSON.stringify({ event: 'payment.captured' });
const whSig = crypto.createHmac('sha256', secret).update(webhookPayload).digest('hex');
const webhookOk = verifyWebhookSignature(webhookPayload, whSig, secret);

console.log(
	JSON.stringify(
		{
			smoke: 'razorpay-signatures',
			checkout_ok: checkoutOk,
			webhook_ok: webhookOk,
			configured: razorpayConfigured(),
		},
		null,
		2
	)
);

if (!checkoutOk || !webhookOk) {
	process.exit(1);
}

if (process.env.RAZORPAY_SMOKE_LIVE === '1') {
	if (!razorpayConfigured()) {
		console.error('RAZORPAY_SMOKE_LIVE=1 but keys missing');
		process.exit(1);
	}
	const rp = await createRazorpayOrder({
		amountPaise: 100,
		receipt: `smoke_${Date.now()}`,
		notes: { grabit_smoke: '1' },
	});
	console.log(JSON.stringify({ smoke: 'razorpay-live-create', ok: rp.ok, data: rp.data }, null, 2));
	process.exit(rp.ok ? 0 : 1);
}
