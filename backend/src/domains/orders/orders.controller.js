import pool from '../../db.js';
import { enqueueOutbox } from '../../events/outbox.js';
import { applyStockForOrderItems } from '../inventory/inventory.service.js';
import { canTransition, stockActionFor } from './order.state.js';
import { deliveryFeePaise, placeOrderForVendor, loadOrder } from './place-order.service.js';
import {
	deliveryOtpExpiresAt,
	generateDeliveryOtp,
	hashOtp,
} from './fulfillment.js';

/**
 * POST /orders
 * body: { vendor_id, items: [{ listing_id, qty }], payment_method?, delivery_address?, fulfillment_mode? }
 * header: Idempotency-Key
 */
export async function placeOrder(req) {
	const vendorId = Number(req.body.vendor_id);
	const items = Array.isArray(req.body.items) ? req.body.items : [];
	const paymentMethod = req.body.payment_method || 'cod';
	const deliveryAddress = req.body.delivery_address || null;
	const fulfillmentMode = req.body.fulfillment_mode || null;

	if (!Number.isInteger(vendorId) || vendorId < 1) {
		return { status: 400, body: { error: 'vendor_id required' } };
	}
	if (!items.length) {
		return { status: 400, body: { error: 'items required' } };
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const { order } = await placeOrderForVendor(client, {
			customerId: req.user.id,
			vendorId,
			items,
			paymentMethod,
			deliveryAddress,
			idempotencyKey: req.idempotencyKey,
			actorUserId: req.user.id,
			fulfillmentMode,
		});

		await client.query('COMMIT');

		const full = await loadOrder(order.id);
		return { status: 201, body: { order: full } };
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return { status: 409, body: { error: 'Duplicate order idempotency key' } };
		}
		if (err.code === 'STOCK_UNAVAILABLE') {
			return {
				status: 409,
				body: { error: 'Insufficient stock', listing_id: err.listingId, available_qty: err.availableQty },
			};
		}
		if (err.code === 'VENDOR_UNAVAILABLE') {
			return { status: 404, body: { error: 'Vendor unavailable' } };
		}
		if (err.code === 'FULFILLMENT_MODE' || err.code === 'VALIDATION' || err.code === 'LISTING_NOT_FOUND') {
			return { status: 400, body: { error: err.message } };
		}
		console.error('placeOrder', err);
		return { status: 500, body: { error: 'Failed to place order' } };
	} finally {
		client.release();
	}
}

export { loadOrder };

export async function listMyOrders(req, res) {
	try {
		const result = await pool.query(
			`SELECT o.*, v.business_name
			 FROM orders o
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.customer_id = $1
			 ORDER BY o.created_at DESC
			 LIMIT 50`,
			[req.user.id]
		);
		return res.json({ orders: result.rows });
	} catch (err) {
		console.error('listMyOrders', err);
		return res.status(500).json({ error: 'Failed to list orders' });
	}
}

export async function listVendorOrders(req, res) {
	try {
		const vendor = await pool.query(`SELECT id FROM vendors WHERE user_id = $1`, [req.user.id]);
		if (vendor.rowCount === 0) return res.status(404).json({ error: 'Vendor not found' });

		const result = await pool.query(
			`SELECT o.*
			 FROM orders o
			 WHERE o.vendor_id = $1
			 ORDER BY o.created_at DESC
			 LIMIT 50`,
			[vendor.rows[0].id]
		);
		return res.json({ orders: result.rows });
	} catch (err) {
		console.error('listVendorOrders', err);
		return res.status(500).json({ error: 'Failed to list vendor orders' });
	}
}

export async function getOrder(req, res) {
	try {
		const order = await loadOrder(Number(req.params.id));
		if (!order) return res.status(404).json({ error: 'Order not found' });

		const vendor = await pool.query(`SELECT id, user_id FROM vendors WHERE id = $1`, [order.vendor_id]);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin'].includes(req.user.role);

		if (!isCustomer && !isVendor && !isStaff) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		return res.json({ order });
	} catch (err) {
		console.error('getOrder', err);
		return res.status(500).json({ error: 'Failed to load order' });
	}
}

/**
 * Transition order status (vendor/customer cancel/staff/delivery).
 * body: { to_status, reason?, delivery_otp? }
 */
export async function transitionOrder(req, res) {
	const orderId = Number(req.params.id);
	const toStatus = String(req.body.to_status || '');
	const reason = req.body.reason || null;
	const deliveryOtp = req.body.delivery_otp != null ? String(req.body.delivery_otp) : null;

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
		if (orderRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Order not found' });
		}

		const order = orderRes.rows[0];
		const vendor = await client.query(`SELECT * FROM vendors WHERE id = $1`, [order.vendor_id]);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin', 'field_agent'].includes(
			req.user.role
		);
		const isDelivery = req.user.role === 'delivery';
		const mode = order.fulfillment_mode || 'self';

		if (!canTransition(order.status, toStatus)) {
			await client.query('ROLLBACK');
			return res.status(400).json({
				error: `Cannot transition ${order.status} → ${toStatus}`,
			});
		}

		const vendorActions = ['accepted', 'rejected', 'preparing', 'ready'];
		if (vendorActions.includes(toStatus) && !isVendor && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Vendor only' });
		}
		if (toStatus === 'cancelled' && !isCustomer && !isVendor && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Not allowed to cancel' });
		}

		// Self-delivery: vendor/staff do picked + delivered (OTP required for delivered)
		// Partner: picked via delivery job pickup; delivered via job complete — block direct partner delivery here unless staff force
		if (toStatus === 'picked') {
			if (mode === 'partner' && !isStaff) {
				await client.query('ROLLBACK');
				return res.status(400).json({
					error: 'Partner delivery: use delivery job pickup',
					code: 'USE_DELIVERY_JOB',
				});
			}
			if (mode === 'self' && !isVendor && !isStaff) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Vendor only for self-delivery pickup' });
			}
		}

		if (toStatus === 'delivered') {
			if (mode === 'partner' && !isStaff) {
				await client.query('ROLLBACK');
				return res.status(400).json({
					error: 'Partner delivery: use delivery job complete',
					code: 'USE_DELIVERY_JOB',
				});
			}
			if (mode === 'self' && !isVendor && !isStaff) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Vendor only for self-delivery complete' });
			}
			if (mode === 'self' && !isStaff) {
				if (!deliveryOtp || !order.delivery_otp_hash) {
					await client.query('ROLLBACK');
					return res.status(400).json({ error: 'delivery_otp required' });
				}
				if (
					!order.delivery_otp_expires_at ||
					new Date(order.delivery_otp_expires_at) < new Date()
				) {
					await client.query('ROLLBACK');
					return res.status(400).json({ error: 'Delivery OTP expired' });
				}
				if (order.delivery_otp_hash !== hashOtp(deliveryOtp)) {
					await client.query('ROLLBACK');
					return res.status(400).json({ error: 'Invalid delivery OTP' });
				}
			}
		}

		// Unused path for delivery role on transition — partner uses jobs API
		if (isDelivery && !isStaff) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Use delivery jobs API' });
		}

		const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
		const stockAction = stockActionFor(order.status, toStatus);
		if (stockAction) {
			await applyStockForOrderItems(client, items.rows, stockAction);
		}

		let deliveryOtpPlain = null;
		const updated = await client.query(
			`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
			[toStatus, orderId]
		);

		// When ready: issue door OTP; create partner job if needed
		if (toStatus === 'ready') {
			deliveryOtpPlain = generateDeliveryOtp();
			await client.query(
				`UPDATE orders
				 SET delivery_otp_hash = $1, delivery_otp_expires_at = $2, updated_at = NOW()
				 WHERE id = $3`,
				[hashOtp(deliveryOtpPlain), deliveryOtpExpiresAt(), orderId]
			);

			if (mode === 'partner') {
				await client.query(
					`INSERT INTO delivery_jobs (order_id, status)
					 VALUES ($1, 'unassigned')
					 ON CONFLICT (order_id) DO NOTHING`,
					[orderId]
				);
			}
		}

		if (['cancelled', 'rejected', 'expired'].includes(toStatus)) {
			await client.query(
				`UPDATE delivery_jobs SET status = 'cancelled', updated_at = NOW()
				 WHERE order_id = $1 AND status IN ('unassigned','assigned','picked_up')`,
				[orderId]
			);
		}

		await client.query(
			`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
			 VALUES ($1, $2, $3, $4, $5::jsonb)`,
			[orderId, order.status, toStatus, req.user.id, JSON.stringify({ reason })]
		);

		await enqueueOutbox(client, {
			eventType: `order.${toStatus}`,
			aggregateType: 'order',
			aggregateId: String(orderId),
			payload: {
				order_id: orderId,
				from: order.status,
				to: toStatus,
				actor_user_id: req.user.id,
				fulfillment_mode: mode,
			},
		});

		await client.query('COMMIT');
		const full = await loadOrder(orderId);
		const body = { order: full };
		// Dev-friendly: return OTP to vendor when marking ready (also SHOW_OTP)
		if (deliveryOtpPlain && (isVendor || isStaff || process.env.SHOW_OTP_IN_RESPONSE === 'true')) {
			body.delivery_otp = deliveryOtpPlain;
		}
		return res.json(body);
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('transitionOrder', err);
		if (err.code?.startsWith('STOCK_')) {
			return res.status(409).json({ error: err.message, code: err.code });
		}
		return res.status(500).json({ error: 'Failed to update order' });
	} finally {
		client.release();
	}
}

export { deliveryFeePaise };

/** Plan aliases — same as transition with fixed to_status */
export async function acceptOrder(req, res) {
	req.body = { ...req.body, to_status: 'accepted' };
	return transitionOrder(req, res);
}

export async function rejectOrder(req, res) {
	req.body = { ...req.body, to_status: 'rejected', reason: req.body.reason || 'rejected' };
	return transitionOrder(req, res);
}

export async function statusOrder(req, res) {
	if (!req.body.to_status && req.body.status) {
		req.body.to_status = req.body.status;
	}
	return transitionOrder(req, res);
}

export async function listOrderEvents(req, res) {
	try {
		const orderId = Number(req.params.id);
		const order = await loadOrder(orderId);
		if (!order) return res.status(404).json({ error: 'Order not found' });

		const vendor = await pool.query(`SELECT id, user_id FROM vendors WHERE id = $1`, [
			order.vendor_id,
		]);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin', 'field_agent'].includes(
			req.user.role
		);
		if (!isCustomer && !isVendor && !isStaff) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		return res.json({ order_id: orderId, events: order.events || [] });
	} catch (err) {
		console.error('listOrderEvents', err);
		return res.status(500).json({ error: 'Failed to load events' });
	}
}

/**
 * GET /orders/delivery-quote?vendor_id=&lat=&lng=
 * Returns fee + distance (Google Distance Matrix when key set).
 */
export async function deliveryQuote(req, res) {
	try {
		const vendorId = Number(req.query.vendor_id);
		const lat = Number(req.query.lat);
		const lng = Number(req.query.lng);
		if (!Number.isInteger(vendorId) || vendorId < 1) {
			return res.status(400).json({ error: 'vendor_id required' });
		}
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			return res.status(400).json({ error: 'lat and lng required' });
		}

		const vendor = await pool.query(
			`SELECT id, business_name, coverage_radius_m, is_approved, is_open,
			        ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
			 FROM vendors WHERE id = $1`,
			[vendorId]
		);
		if (vendor.rowCount === 0) return res.status(404).json({ error: 'Vendor not found' });
		const v = vendor.rows[0];
		if (!v.is_approved || !v.is_open) {
			return res.status(400).json({ error: 'Vendor unavailable' });
		}
		if (v.lat == null || v.lng == null) {
			return res.status(400).json({ error: 'Vendor has no location' });
		}

		const { distanceMeters } = await import('../geo/geocode.service.js');
		const dist = await distanceMeters(Number(v.lat), Number(v.lng), lat, lng);
		const inCoverage = dist.distance_m <= Number(v.coverage_radius_m || 3000);
		const fee = deliveryFeePaise();

		return res.json({
			vendor_id: vendorId,
			business_name: v.business_name,
			serviceable: inCoverage,
			coverage_radius_m: v.coverage_radius_m,
			distance_m: dist.distance_m,
			duration_s: dist.duration_s,
			provider: dist.provider,
			delivery_fee_paise: inCoverage ? fee : null,
		});
	} catch (err) {
		console.error('deliveryQuote', err);
		return res.status(500).json({ error: 'Failed to quote delivery' });
	}
}

/**
 * Live tracking / ETA for an order (partner location when available).
 */
export async function trackOrder(req, res) {
	try {
		const orderId = Number(req.params.id);
		const order = await loadOrder(orderId);
		if (!order) return res.status(404).json({ error: 'Order not found' });

		const vendor = await pool.query(
			`SELECT id, user_id, business_name,
			        ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
			 FROM vendors WHERE id = $1`,
			[order.vendor_id]
		);
		const isCustomer = order.customer_id === req.user.id;
		const isVendor = vendor.rows[0]?.user_id === req.user.id;
		const isStaff = ['super_admin', 'support', 'regional_admin', 'field_agent', 'delivery'].includes(
			req.user.role
		);
		if (!isCustomer && !isVendor && !isStaff) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const job = await pool.query(
			`SELECT j.*, 
			        ST_Y(dp.location::geometry) AS partner_lat,
			        ST_X(dp.location::geometry) AS partner_lng,
			        dp.id AS delivery_partner_id
			 FROM delivery_jobs j
			 LEFT JOIN delivery_partners dp ON dp.id = j.partner_id
			 WHERE j.order_id = $1`,
			[orderId]
		);

		const dropoff = order.delivery_address_snapshot || {};
		const dropLat = Number(dropoff.lat);
		const dropLng = Number(dropoff.lng);

		let eta = null;
		const partnerLat = job.rows[0]?.partner_lat != null ? Number(job.rows[0].partner_lat) : null;
		const partnerLng = job.rows[0]?.partner_lng != null ? Number(job.rows[0].partner_lng) : null;
		const fromLat = partnerLat ?? (vendor.rows[0]?.lat != null ? Number(vendor.rows[0].lat) : null);
		const fromLng = partnerLng ?? (vendor.rows[0]?.lng != null ? Number(vendor.rows[0].lng) : null);

		if (
			Number.isFinite(fromLat) &&
			Number.isFinite(fromLng) &&
			Number.isFinite(dropLat) &&
			Number.isFinite(dropLng)
		) {
			const { distanceMeters } = await import('../geo/geocode.service.js');
			eta = await distanceMeters(fromLat, fromLng, dropLat, dropLng);
		}

		return res.json({
			order_id: orderId,
			status: order.status,
			fulfillment_mode: order.fulfillment_mode,
			vendor: {
				id: vendor.rows[0]?.id,
				business_name: vendor.rows[0]?.business_name,
				lat: vendor.rows[0]?.lat != null ? Number(vendor.rows[0].lat) : null,
				lng: vendor.rows[0]?.lng != null ? Number(vendor.rows[0].lng) : null,
			},
			dropoff: Number.isFinite(dropLat)
				? { lat: dropLat, lng: dropLng }
				: dropoff,
			job: job.rows[0]
				? {
						id: job.rows[0].id,
						status: job.rows[0].status,
						partner_id: job.rows[0].partner_id,
						partner_lat: partnerLat,
						partner_lng: partnerLng,
					}
				: null,
			eta,
		});
	} catch (err) {
		console.error('trackOrder', err);
		return res.status(500).json({ error: 'Failed to load tracking' });
	}
}
