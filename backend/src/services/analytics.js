/**
 * Record outbox-derived analytics (eventual). Call inside the same TX as consume when possible.
 */
export async function recordAnalyticsEvent(client, row) {
	const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {};
	let cityId = p.city_id || null;
	let vendorId = p.vendor_id || null;
	const orderId = p.order_id || null;
	const bookingId = p.booking_id || null;
	const customerId = p.customer_id || null;

	if (orderId && (!cityId || !vendorId)) {
		const o = await client.query(
			`SELECT o.vendor_id, o.customer_id, v.city_id
			 FROM orders o JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.id = $1`,
			[orderId]
		);
		if (o.rowCount) {
			vendorId = vendorId || o.rows[0].vendor_id;
			cityId = cityId || o.rows[0].city_id;
		}
	}

	await client.query(
		`INSERT INTO analytics_events (
			event_type, city_id, vendor_id, order_id, booking_id, customer_id, payload, outbox_id
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
		[
			row.event_type,
			cityId,
			vendorId,
			orderId,
			bookingId,
			customerId,
			JSON.stringify(p),
			row.id || null,
		]
	);

	// Light daily counters for pilot metrics
	const metrics = [];
	if (row.event_type === 'order.placed') metrics.push('orders_placed');
	if (row.event_type === 'order.delivered') metrics.push('orders_delivered');
	if (row.event_type === 'order.cancelled' || row.event_type === 'order.rejected') {
		metrics.push('orders_cancelled');
	}
	if (row.event_type === 'order.accepted') metrics.push('orders_accepted');
	if (row.event_type === 'payment.paid') metrics.push('payments_paid');
	if (row.event_type === 'dispute.opened') metrics.push('disputes_opened');
	if (row.event_type.startsWith('service_booking.')) metrics.push('service_bookings');

	for (const metric of metrics) {
		await client.query(
			`INSERT INTO analytics_daily (day, city_id, metric, value)
			 VALUES (CURRENT_DATE, COALESCE($1, 0), $2, 1)
			 ON CONFLICT (day, metric, city_id)
			 DO UPDATE SET value = analytics_daily.value + 1`,
			[cityId, metric]
		);
	}
}
