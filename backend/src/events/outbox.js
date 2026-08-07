/**
 * Write an outbox row inside an existing transaction client.
 * Relay worker publishes later (BullMQ / Redis Streams in next phase).
 */
export async function enqueueOutbox(client, { eventType, payload, aggregateType, aggregateId, version = 1 }) {
	const result = await client.query(
		`INSERT INTO outbox (event_type, event_version, payload, aggregate_type, aggregate_id)
		 VALUES ($1, $2, $3::jsonb, $4, $5)
		 RETURNING id`,
		[eventType, version, JSON.stringify(payload), aggregateType || null, aggregateId || null]
	);
	return result.rows[0].id;
}
