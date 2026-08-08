import pool from '../../db.js';

function cityFilter(req) {
	if (['regional_admin', 'field_agent'].includes(req.user?.role)) return req.user.city_id;
	const q = req.query.city_id != null ? Number(req.query.city_id) : null;
	return Number.isInteger(q) ? q : null;
}

/**
 * Pilot survival metrics from analytics_daily + live order stats.
 * GET /api/analytics/pilot
 */
export async function pilotMetrics(req, res) {
	try {
		const cityId = cityFilter(req);
		const days = Math.min(Number(req.query.days) || 14, 90);

		const daily = await pool.query(
			`SELECT day, city_id, metric, value
			 FROM analytics_daily
			 WHERE day >= CURRENT_DATE - ($1::int)
			   AND ($2::int IS NULL OR city_id = $2 OR city_id = 0)
			 ORDER BY day DESC, metric`,
			[days, cityId]
		);

		const acceptance = await pool.query(
			`SELECT
			   COUNT(*) FILTER (WHERE o.status = 'placed')::int AS still_placed,
			   COUNT(*) FILTER (WHERE ae.event_type = 'order.accepted')::int AS accepted_events,
			   COUNT(*) FILTER (WHERE ae.event_type = 'order.placed')::int AS placed_events
			 FROM analytics_events ae
			 LEFT JOIN orders o ON o.id = ae.order_id
			 WHERE ae.occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
			   AND ($2::int IS NULL OR ae.city_id = $2)`,
			[days, cityId]
		);

		const fill = await pool.query(
			`SELECT
			   COUNT(*) FILTER (WHERE event_type = 'order.placed')::int AS placed,
			   COUNT(*) FILTER (WHERE event_type = 'order.delivered')::int AS delivered
			 FROM analytics_events
			 WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
			   AND ($2::int IS NULL OR city_id = $2)`,
			[days, cityId]
		);

		const gmv = await pool.query(
			`SELECT COALESCE(SUM(o.total_paise), 0)::bigint AS gmv_paise
			 FROM orders o
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.status = 'delivered'
			   AND o.updated_at >= NOW() - ($1::int * INTERVAL '1 day')
			   AND ($2::int IS NULL OR v.city_id = $2)`,
			[days, cityId]
		);

		const placed = fill.rows[0].placed || 0;
		const delivered = fill.rows[0].delivered || 0;
		const placedEv = acceptance.rows[0].placed_events || 0;
		const acceptedEv = acceptance.rows[0].accepted_events || 0;

		return res.json({
			window_days: days,
			city_id: cityId,
			metrics: {
				orders_placed: placed,
				orders_delivered: delivered,
				fill_rate: placed > 0 ? Number((delivered / placed).toFixed(3)) : null,
				acceptance_rate: placedEv > 0 ? Number((acceptedEv / placedEv).toFixed(3)) : null,
				gmv_paise: Number(gmv.rows[0].gmv_paise),
			},
			daily: daily.rows,
		});
	} catch (err) {
		console.error('pilotMetrics', err);
		return res.status(500).json({ error: 'Failed to load analytics' });
	}
}

export async function recentEvents(req, res) {
	try {
		const cityId = cityFilter(req);
		const result = await pool.query(
			`SELECT id, event_type, occurred_at, city_id, vendor_id, order_id, booking_id
			 FROM analytics_events
			 WHERE ($1::int IS NULL OR city_id = $1)
			 ORDER BY id DESC
			 LIMIT 100`,
			[cityId]
		);
		return res.json({ events: result.rows });
	} catch (err) {
		console.error('recentEvents', err);
		return res.status(500).json({ error: 'Failed to load events' });
	}
}
