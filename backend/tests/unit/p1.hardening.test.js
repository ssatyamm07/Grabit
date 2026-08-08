import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
	verifyCheckoutSignature,
	verifyWebhookSignature,
} from '../../src/services/razorpay.js';
import { maskPhone, maskEmail, shouldMaskPii } from '../../src/services/audit.js';

describe('razorpay signatures', () => {
	it('verifies checkout HMAC', () => {
		const secret = 'sk_test_smoke';
		const orderId = 'order_abc';
		const paymentId = 'pay_xyz';
		const sig = crypto
			.createHmac('sha256', secret)
			.update(`${orderId}|${paymentId}`)
			.digest('hex');
		assert.equal(
			verifyCheckoutSignature({
				razorpay_order_id: orderId,
				razorpay_payment_id: paymentId,
				razorpay_signature: sig,
				secret,
			}),
			true
		);
		assert.equal(
			verifyCheckoutSignature({
				razorpay_order_id: orderId,
				razorpay_payment_id: paymentId,
				razorpay_signature: 'deadbeef',
				secret,
			}),
			false
		);
	});

	it('verifies webhook HMAC', () => {
		const secret = 'whsec';
		const raw = '{"event":"payment.captured"}';
		const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
		assert.equal(verifyWebhookSignature(raw, sig, secret), true);
		assert.equal(verifyWebhookSignature(raw, 'nope', secret), false);
	});
});

describe('PII masking', () => {
	it('masks phone and email', () => {
		assert.equal(maskPhone('9111111111'), '******1111');
		assert.equal(maskEmail('satyam@grabit.in'), 's***@grabit.in');
	});

	it('support masks; super_admin does not', () => {
		assert.equal(shouldMaskPii({ user: { role: 'support' }, query: {} }), true);
		assert.equal(shouldMaskPii({ user: { role: 'super_admin' }, query: {} }), false);
		assert.equal(
			shouldMaskPii({ user: { role: 'regional_admin' }, query: { unmask: '1' } }),
			false
		);
	});
});
