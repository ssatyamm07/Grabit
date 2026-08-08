import pool from '../db.js';

function isDryRun(channel) {
	if (process.env.NODE_ENV === 'test') return true;
	if (channel === 'push') {
		return process.env.PUSH_DRY_RUN === 'true' || !process.env.EXPO_ACCESS_TOKEN;
	}
	if (channel === 'sms') {
		return process.env.SMS_DRY_RUN === 'true' || !process.env.MSG91_AUTH_KEY;
	}
	return true;
}

async function logNotification(client, row) {
	const q = client || pool;
	await q.query(
		`INSERT INTO notification_log (
			channel, user_id, phone, title, body, event_type, outbox_id, status, provider_response
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
		[
			row.channel,
			row.user_id || null,
			row.phone || null,
			row.title || null,
			row.body || null,
			row.event_type || null,
			row.outbox_id || null,
			row.status,
			JSON.stringify(row.provider_response || {}),
		]
	);
}

async function sendExpoPush(messages) {
	const res = await fetch('https://exp.host/--/api/v2/push/send', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(process.env.EXPO_ACCESS_TOKEN
				? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
				: {}),
		},
		body: JSON.stringify(messages),
	});
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data };
}

/**
 * Push notify a user via registered Expo devices. Always writes notification_log.
 */
export async function pushToUser(client, { userId, title, body, data, eventType, outboxId }) {
	if (!userId) {
		await logNotification(client, {
			channel: 'push',
			user_id: null,
			title,
			body,
			event_type: eventType,
			outbox_id: outboxId,
			status: 'skipped',
			provider_response: { reason: 'no_user' },
		});
		return { status: 'skipped' };
	}

	const devices = await client.query(
		`SELECT expo_push_token FROM devices WHERE user_id = $1`,
		[userId]
	);
	if (devices.rowCount === 0) {
		await logNotification(client, {
			channel: 'push',
			user_id: userId,
			title,
			body,
			event_type: eventType,
			outbox_id: outboxId,
			status: 'skipped',
			provider_response: { reason: 'no_devices' },
		});
		return { status: 'skipped' };
	}

	const messages = devices.rows.map((d) => ({
		to: d.expo_push_token,
		sound: 'default',
		title,
		body,
		data: data || {},
	}));

	if (isDryRun('push')) {
		await logNotification(client, {
			channel: 'push',
			user_id: userId,
			title,
			body,
			event_type: eventType,
			outbox_id: outboxId,
			status: 'dry_run',
			provider_response: { sent: messages.length, tokens: messages.map((m) => m.to) },
		});
		return { status: 'dry_run', sent: messages.length };
	}

	const result = await sendExpoPush(messages);
	await logNotification(client, {
		channel: 'push',
		user_id: userId,
		title,
		body,
		event_type: eventType,
		outbox_id: outboxId,
		status: result.ok ? 'sent' : 'failed',
		provider_response: result,
	});
	if (!result.ok) throw new Error(`Expo push failed: ${result.status}`);
	return { status: 'sent', sent: messages.length };
}

/**
 * SMS via MSG91 (or dry-run). Looks up phone from users when not provided.
 */
export async function smsToUser(client, { userId, phone, body, eventType, outboxId, title }) {
	let toPhone = phone;
	if (!toPhone && userId) {
		const u = await client.query(`SELECT phone FROM users WHERE id = $1`, [userId]);
		toPhone = u.rows[0]?.phone;
	}
	if (!toPhone) {
		await logNotification(client, {
			channel: 'sms',
			user_id: userId,
			title: title || null,
			body,
			event_type: eventType,
			outbox_id: outboxId,
			status: 'skipped',
			provider_response: { reason: 'no_phone' },
		});
		return { status: 'skipped' };
	}

	if (isDryRun('sms')) {
		await logNotification(client, {
			channel: 'sms',
			user_id: userId,
			phone: toPhone,
			title: title || null,
			body,
			event_type: eventType,
			outbox_id: outboxId,
			status: 'dry_run',
			provider_response: { provider: 'msg91', dry_run: true },
		});
		return { status: 'dry_run' };
	}

	const authKey = process.env.MSG91_AUTH_KEY;
	const templateId = process.env.MSG91_TEMPLATE_ID;
	const sender = process.env.MSG91_SENDER_ID || 'GRABIT';
	const res = await fetch('https://control.msg91.com/api/v5/flow/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			authkey: authKey,
		},
		body: JSON.stringify({
			template_id: templateId,
			sender,
			short_url: '0',
			recipients: [{ mobiles: `91${String(toPhone).replace(/\D/g, '').slice(-10)}`, VAR1: body }],
		}),
	});
	const data = await res.json().catch(() => ({}));
	const ok = res.ok;
	await logNotification(client, {
		channel: 'sms',
		user_id: userId,
		phone: toPhone,
		title: title || null,
		body,
		event_type: eventType,
		outbox_id: outboxId,
		status: ok ? 'sent' : 'failed',
		provider_response: data,
	});
	if (!ok) throw new Error(`MSG91 SMS failed: ${res.status}`);
	return { status: 'sent' };
}
