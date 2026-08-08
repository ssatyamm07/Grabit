import { pushToUser, smsToUser } from '../services/notifications.js';
import { recordAnalyticsEvent } from '../services/analytics.js';

const SMS_EVENTS_FULL = new Set([
	'order.placed',
	'order.delivered',
	'order.cancelled',
	'dispute.opened',
	'service_booking.accepted',
	'service_booking.cancelled',
	'store_verification.passed',
	'store_verification.failed',
	'payment.paid',
]);

/** Lean default: SMS only for login OTP (separate path). Order updates = free Expo push. */
function smsEventsEnabled() {
	return process.env.SMS_ORDER_UPDATES === 'true';
}

function titleFor(eventType) {
	const map = {
		'order.placed': 'Order placed',
		'order.accepted': 'Order accepted',
		'order.ready': 'Order ready',
		'order.out_for_delivery': 'Out for delivery',
		'order.delivered': 'Delivered',
		'order.cancelled': 'Order cancelled',
		'order.rejected': 'Order rejected',
		'order_group.placed': 'Multi-vendor order placed',
		'payment.created': 'Payment created',
		'payment.paid': 'Payment received',
		'delivery_job.assigned': 'Delivery assigned',
		'delivery_job.picked_up': 'Order picked up',
		'delivery_job.completed': 'Delivery completed',
		'dispute.opened': 'Dispute opened',
		'dispute.resolved': 'Dispute resolved',
		'dispute.rejected': 'Dispute closed',
		'dispute.in_review': 'Dispute in review',
		'dispute.escalated': 'Dispute escalated',
		'service_booking.requested': 'New service booking',
		'service_booking.accepted': 'Booking accepted',
		'service_booking.rejected': 'Booking declined',
		'service_booking.in_progress': 'Service in progress',
		'service_booking.completed': 'Service completed',
		'service_booking.cancelled': 'Booking cancelled',
		'service_booking.no_show': 'No-show recorded',
		'store_verification.scheduled': 'Store visit scheduled',
		'store_verification.in_progress': 'Verification in progress',
		'store_verification.passed': 'Store verified',
		'store_verification.failed': 'Verification failed',
		'store_verification.cancelled': 'Verification cancelled',
	};
	return map[eventType] || eventType.replace(/\./g, ' ');
}

function bodyFor(eventType, payload) {
	if (payload?.reason) return String(payload.reason).slice(0, 160);
	if (payload?.order_id) return `Order #${payload.order_id}`;
	if (payload?.booking_id) return `Booking #${payload.booking_id}`;
	if (payload?.verification_id) return `Visit #${payload.verification_id}`;
	if (payload?.dispute_id) return `Dispute #${payload.dispute_id}`;
	return titleFor(eventType);
}

/**
 * Resolve who should be notified for an outbox event.
 * Returns [{ userId, channels: ['push'|'sms'] }]
 */
export async function resolveRecipients(client, { event_type: eventType, payload }) {
	const p = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
	const wantSms = smsEventsEnabled() && SMS_EVENTS_FULL.has(eventType);
	const channels = wantSms ? ['push', 'sms'] : ['push'];
	const recipients = new Map();

	function add(userId) {
		if (!userId) return;
		const id = Number(userId);
		if (!Number.isInteger(id)) return;
		recipients.set(id, { userId: id, channels: [...channels] });
	}

	add(p.customer_id);
	add(p.vendor_user_id);
	add(p.opened_by);
	add(p.field_agent_id);
	add(p.delivery_user_id);
	add(p.user_id);

	if (p.order_id && (!p.customer_id || !p.vendor_user_id)) {
		const o = await client.query(
			`SELECT o.customer_id, v.user_id AS vendor_user_id
			 FROM orders o JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.id = $1`,
			[p.order_id]
		);
		if (o.rowCount) {
			add(o.rows[0].customer_id);
			add(o.rows[0].vendor_user_id);
		}
	}

	if (eventType.startsWith('delivery_job.') && p.job_id && !p.delivery_user_id) {
		const j = await client.query(
			`SELECT dp.user_id AS delivery_user_id, o.customer_id, v.user_id AS vendor_user_id
			 FROM delivery_jobs j
			 JOIN delivery_partners dp ON dp.id = j.partner_id
			 JOIN orders o ON o.id = j.order_id
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE j.id = $1`,
			[p.job_id]
		);
		if (j.rowCount) {
			add(j.rows[0].delivery_user_id);
			add(j.rows[0].customer_id);
			add(j.rows[0].vendor_user_id);
		}
	}

	if (eventType.startsWith('store_verification.') && p.vendor_id && !p.vendor_user_id) {
		const v = await client.query(`SELECT user_id FROM vendors WHERE id = $1`, [p.vendor_id]);
		add(v.rows[0]?.user_id);
	}

	// Staff digest for disputes
	if (eventType.startsWith('dispute.')) {
		const staff = await client.query(
			`SELECT id FROM users
			 WHERE role IN ('super_admin','support','regional_admin') AND is_active = TRUE
			 LIMIT 20`
		);
		for (const s of staff.rows) add(s.id);
	}

	return {
		recipients: [...recipients.values()],
		title: titleFor(eventType),
		body: bodyFor(eventType, p),
		data: { event_type: eventType, ...p },
	};
}

/**
 * Deliver push (+ optional SMS) for one outbox row. Throws on hard failure.
 */
export async function consumeOutboxEvent(client, row) {
	await recordAnalyticsEvent(client, row);

	const { recipients, title, body, data } = await resolveRecipients(client, row);
	if (recipients.length === 0) {
		await pushToUser(client, {
			userId: null,
			title,
			body,
			data,
			eventType: row.event_type,
			outboxId: row.id,
		});
		return { notified: 0 };
	}

	let notified = 0;
	for (const r of recipients) {
		if (r.channels.includes('push')) {
			await pushToUser(client, {
				userId: r.userId,
				title,
				body,
				data,
				eventType: row.event_type,
				outboxId: row.id,
			});
			notified += 1;
		}
		if (r.channels.includes('sms')) {
			await smsToUser(client, {
				userId: r.userId,
				title,
				body,
				eventType: row.event_type,
				outboxId: row.id,
			});
		}
	}
	return { notified };
}
