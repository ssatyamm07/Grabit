/** Audit + PII helpers for support/admin surfaces */
export function maskPhone(phone) {
	const digits = String(phone || '').replace(/\D/g, '');
	if (digits.length < 4) return '****';
	return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskEmail(email) {
	const s = String(email || '');
	const at = s.indexOf('@');
	if (at < 1) return s ? '***' : null;
	return `${s[0]}***${s.slice(at)}`;
}

/**
 * Support / field see masked PII by default.
 * regional_admin can pass ?unmask=1; super_admin always full.
 */
export function shouldMaskPii(req) {
	if (req.user?.role === 'super_admin') return false;
	if (req.user?.role === 'regional_admin') {
		return !(req.query?.unmask === '1' || req.query?.unmask === 'true');
	}
	return ['support', 'field_agent'].includes(req.user?.role);
}

export function maskUserRow(row) {
	if (!row) return row;
	return {
		...row,
		phone: maskPhone(row.phone),
		email: row.email ? maskEmail(row.email) : row.email,
	};
}

export async function writeAuditLog(clientOrPool, {
	actorUserId,
	action,
	entityType,
	entityId,
	meta = {},
	ip = null,
}) {
	await clientOrPool.query(
		`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, meta, ip)
		 VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
		[
			actorUserId || null,
			action,
			entityType || null,
			entityId != null ? String(entityId) : null,
			JSON.stringify(meta),
			ip,
		]
	);
}
