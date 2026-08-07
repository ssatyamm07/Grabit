/** Double-entry style ledger writes (paise integers). Run inside a transaction. */

export async function writeLedgerEntry(
	client,
	{ accountRef, direction, amountPaise, reason, referenceType, referenceId }
) {
	if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
		throw new Error('amount_paise must be positive integer');
	}
	if (!['credit', 'debit'].includes(direction)) {
		throw new Error('direction must be credit|debit');
	}

	const result = await client.query(
		`INSERT INTO ledger_entries
		 (account_ref, direction, amount_paise, reason, reference_type, reference_id)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING *`,
		[accountRef, direction, amountPaise, reason, referenceType || null, referenceId || null]
	);
	return result.rows[0];
}

/** On order placed (COD): debit customer payable, credit vendor receivable (gross) */
export async function recordOrderPlacedLedger(client, { orderId, customerId, vendorId, totalPaise }) {
	await writeLedgerEntry(client, {
		accountRef: `customer:${customerId}`,
		direction: 'debit',
		amountPaise: totalPaise,
		reason: 'order_placed',
		referenceType: 'order',
		referenceId: String(orderId),
	});
	await writeLedgerEntry(client, {
		accountRef: `vendor:${vendorId}`,
		direction: 'credit',
		amountPaise: totalPaise,
		reason: 'order_receivable',
		referenceType: 'order',
		referenceId: String(orderId),
	});
}

export async function getBalancePaise(accountRef) {
	const pool = (await import('../../db.js')).default;
	const result = await pool.query(
		`SELECT
			COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END), 0)
			-
			COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END), 0)
			AS balance_paise
		 FROM ledger_entries
		 WHERE account_ref = $1`,
		[accountRef]
	);
	return Number(result.rows[0].balance_paise);
}

export async function listEntries(accountRef, limit = 50) {
	const pool = (await import('../../db.js')).default;
	const result = await pool.query(
		`SELECT * FROM ledger_entries
		 WHERE account_ref = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2`,
		[accountRef, limit]
	);
	return result.rows;
}
