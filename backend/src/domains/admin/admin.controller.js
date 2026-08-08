import pool from '../../db.js';
import { loadOrder } from '../orders/place-order.service.js';
import { canTransition, stockActionFor } from '../orders/order.state.js';
import { applyStockForOrderItems } from '../inventory/inventory.service.js';
import { enqueueOutbox } from '../../events/outbox.js';

const STAFF = ['super_admin', 'regional_admin', 'support', 'field_agent'];

function assertStaff(req, res) {
	if (!STAFF.includes(req.user?.role)) {
		res.status(403).json({ error: 'Staff only' });
		return false;
	}
	return true;
}

function cityFilter(req) {
	const scoped = ['regional_admin', 'field_agent'];
	if (scoped.includes(req.user.role)) return req.user.city_id;
	return null;
}

export async function stats(req, res) {
	try {
		const cityId = cityFilter(req);
		const pendingVendors = await pool.query(
			`SELECT COUNT(*)::int AS c FROM vendors
			 WHERE is_approved = FALSE
			   AND ($1::int IS NULL OR city_id = $1)`,
			[cityId]
		);
		const openVendors = await pool.query(
			`SELECT COUNT(*)::int AS c FROM vendors
			 WHERE is_approved = TRUE AND is_open = TRUE
			   AND ($1::int IS NULL OR city_id = $1)`,
			[cityId]
		);
		const ordersToday = await pool.query(
			`SELECT COUNT(*)::int AS c FROM orders o
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE o.placed_at::date = CURRENT_DATE
			   AND ($1::int IS NULL OR v.city_id = $1)`,
			[cityId]
		);
		const pendingProposals = await pool.query(
			`SELECT COUNT(*)::int AS c FROM vendor_product_proposals p
			 JOIN vendors v ON v.id = p.vendor_id
			 WHERE p.status = 'pending'
			   AND ($1::int IS NULL OR v.city_id = $1)`,
			[cityId]
		);

		return res.json({
			stats: {
				pending_vendors: pendingVendors.rows[0].c,
				open_vendors: openVendors.rows[0].c,
				orders_today: ordersToday.rows[0].c,
				pending_proposals: pendingProposals.rows[0].c,
			},
		});
	} catch (err) {
		console.error('admin.stats', err);
		return res.status(500).json({ error: 'Failed to load stats' });
	}
}

export async function listVendors(req, res) {
	try {
		const cityId = cityFilter(req);
		const approved =
			req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : null;
		const result = await pool.query(
			`SELECT v.*, u.phone, u.name AS owner_name
			 FROM vendors v
			 JOIN users u ON u.id = v.user_id
			 WHERE ($1::int IS NULL OR v.city_id = $1)
			   AND ($2::boolean IS NULL OR v.is_approved = $2)
			 ORDER BY v.created_at DESC
			 LIMIT 100`,
			[cityId, approved]
		);
		return res.json({ vendors: result.rows });
	} catch (err) {
		console.error('admin.listVendors', err);
		return res.status(500).json({ error: 'Failed to list vendors' });
	}
}

export async function approveVendor(req, res) {
	try {
		const vendorId = Number(req.params.id);
		const cityId = cityFilter(req);
		const result = await pool.query(
			`UPDATE vendors SET is_approved = TRUE
			 WHERE id = $1 AND ($2::int IS NULL OR city_id = $2)
			 RETURNING *`,
			[vendorId, cityId]
		);
		if (result.rowCount === 0) {
			return res.status(404).json({ error: 'Vendor not found or outside city scope' });
		}
		return res.json({ vendor: result.rows[0] });
	} catch (err) {
		console.error('admin.approveVendor', err);
		return res.status(500).json({ error: 'Failed to approve vendor' });
	}
}

export async function rejectVendor(req, res) {
	try {
		const vendorId = Number(req.params.id);
		const cityId = cityFilter(req);
		const result = await pool.query(
			`UPDATE vendors SET is_approved = FALSE, is_open = FALSE
			 WHERE id = $1 AND ($2::int IS NULL OR city_id = $2)
			 RETURNING *`,
			[vendorId, cityId]
		);
		if (result.rowCount === 0) {
			return res.status(404).json({ error: 'Vendor not found or outside city scope' });
		}
		return res.json({ vendor: result.rows[0] });
	} catch (err) {
		console.error('admin.rejectVendor', err);
		return res.status(500).json({ error: 'Failed to reject vendor' });
	}
}

export async function listUsers(req, res) {
	try {
		const q = String(req.query.q || '').trim();
		const cityId = cityFilter(req);
		const result = await pool.query(
			`SELECT id, name, phone, email, role, city_id, is_active, phone_verified, created_at
			 FROM users
			 WHERE ($1::int IS NULL OR city_id = $1 OR role = 'super_admin')
			   AND (
			     $2 = '' OR phone ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%'
			   )
			 ORDER BY id DESC
			 LIMIT 100`,
			[cityId, q]
		);
		return res.json({ users: result.rows });
	} catch (err) {
		console.error('admin.listUsers', err);
		return res.status(500).json({ error: 'Failed to list users' });
	}
}

export async function deactivateUser(req, res) {
	try {
		const userId = Number(req.params.id);
		if (userId === req.user.id) {
			return res.status(400).json({ error: 'Cannot deactivate yourself' });
		}
		const result = await pool.query(
			`UPDATE users SET is_active = FALSE, updated_at = NOW()
			 WHERE id = $1
			 RETURNING id, name, phone, role, is_active`,
			[userId]
		);
		if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
		return res.json({ user: result.rows[0] });
	} catch (err) {
		console.error('admin.deactivateUser', err);
		return res.status(500).json({ error: 'Failed to deactivate user' });
	}
}

export async function createMasterProduct(req, res) {
	try {
		const name = String(req.body.name || '').trim();
		if (!name) return res.status(400).json({ error: 'name required' });
		const result = await pool.query(
			`INSERT INTO master_products (name, brand, barcode, category, unit_label, images)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb)
			 RETURNING *`,
			[
				name,
				req.body.brand || null,
				req.body.barcode || null,
				req.body.category || null,
				req.body.unit_label || null,
				JSON.stringify(req.body.images || []),
			]
		);
		return res.status(201).json({ product: result.rows[0] });
	} catch (err) {
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Barcode already exists' });
		}
		console.error('admin.createMasterProduct', err);
		return res.status(500).json({ error: 'Failed to create product' });
	}
}

export async function updateMasterProduct(req, res) {
	try {
		const id = Number(req.params.id);
		const fields = [];
		const values = [];
		let i = 1;
		for (const key of ['name', 'brand', 'barcode', 'category', 'unit_label']) {
			if (req.body[key] !== undefined) {
				fields.push(`${key} = $${i++}`);
				values.push(req.body[key]);
			}
		}
		if (req.body.images !== undefined) {
			fields.push(`images = $${i++}::jsonb`);
			values.push(JSON.stringify(req.body.images));
		}
		if (!fields.length) return res.status(400).json({ error: 'No fields' });
		values.push(id);
		const result = await pool.query(
			`UPDATE master_products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
			values
		);
		if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
		return res.json({ product: result.rows[0] });
	} catch (err) {
		console.error('admin.updateMasterProduct', err);
		return res.status(500).json({ error: 'Failed to update product' });
	}
}

export async function listProposals(req, res) {
	try {
		const cityId = cityFilter(req);
		const result = await pool.query(
			`SELECT p.*, v.business_name, v.city_id
			 FROM vendor_product_proposals p
			 JOIN vendors v ON v.id = p.vendor_id
			 WHERE p.status = 'pending'
			   AND ($1::int IS NULL OR v.city_id = $1)
			 ORDER BY p.created_at ASC`,
			[cityId]
		);
		return res.json({ proposals: result.rows });
	} catch (err) {
		console.error('admin.listProposals', err);
		return res.status(500).json({ error: 'Failed to list proposals' });
	}
}

export async function approveProposal(req, res) {
	const proposalId = Number(req.params.id);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const prop = await client.query(
			`SELECT p.*, v.city_id FROM vendor_product_proposals p
			 JOIN vendors v ON v.id = p.vendor_id
			 WHERE p.id = $1 FOR UPDATE OF p`,
			[proposalId]
		);
		if (prop.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Proposal not found' });
		}
		const p = prop.rows[0];
		const cityId = cityFilter(req);
		if (cityId != null && p.city_id !== cityId) {
			await client.query('ROLLBACK');
			return res.status(403).json({ error: 'Outside city scope' });
		}
		if (p.status !== 'pending') {
			await client.query('ROLLBACK');
			return res.status(409).json({ error: 'Already reviewed' });
		}

		const product = await client.query(
			`INSERT INTO master_products (name, brand, barcode, category, unit_label)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING *`,
			[p.name, p.brand, p.barcode, p.category, p.unit_label]
		);

		await client.query(
			`UPDATE vendor_product_proposals
			 SET status = 'approved', master_product_id = $1, reviewed_by = $2, reviewed_at = NOW()
			 WHERE id = $3`,
			[product.rows[0].id, req.user.id, proposalId]
		);

		await client.query('COMMIT');
		return res.json({ product: product.rows[0], proposal_id: proposalId });
	} catch (err) {
		await client.query('ROLLBACK');
		if (err.code === '23505') {
			return res.status(409).json({ error: 'Barcode conflict with existing master product' });
		}
		console.error('admin.approveProposal', err);
		return res.status(500).json({ error: 'Failed to approve proposal' });
	} finally {
		client.release();
	}
}

export async function rejectProposal(req, res) {
	try {
		const proposalId = Number(req.params.id);
		const cityId = cityFilter(req);
		const result = await pool.query(
			`UPDATE vendor_product_proposals p
			 SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
			 FROM vendors v
			 WHERE p.id = $2 AND p.vendor_id = v.id AND p.status = 'pending'
			   AND ($3::int IS NULL OR v.city_id = $3)
			 RETURNING p.*`,
			[req.user.id, proposalId, cityId]
		);
		if (result.rowCount === 0) {
			return res.status(404).json({ error: 'Proposal not found' });
		}
		return res.json({ proposal: result.rows[0] });
	} catch (err) {
		console.error('admin.rejectProposal', err);
		return res.status(500).json({ error: 'Failed to reject proposal' });
	}
}

export async function listOrders(req, res) {
	try {
		const cityId = cityFilter(req);
		const status = req.query.status ? String(req.query.status) : null;
		const result = await pool.query(
			`SELECT o.*, v.business_name, v.city_id
			 FROM orders o
			 JOIN vendors v ON v.id = o.vendor_id
			 WHERE ($1::int IS NULL OR v.city_id = $1)
			   AND ($2::text IS NULL OR o.status = $2)
			 ORDER BY o.created_at DESC
			 LIMIT 100`,
			[cityId, status]
		);
		return res.json({ orders: result.rows });
	} catch (err) {
		console.error('admin.listOrders', err);
		return res.status(500).json({ error: 'Failed to list orders' });
	}
}

export async function forceTransition(req, res) {
	const orderId = Number(req.params.id);
	const toStatus = String(req.body.to_status || '');
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
		if (orderRes.rowCount === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Order not found' });
		}
		const order = orderRes.rows[0];
		const cityId = cityFilter(req);
		if (cityId != null) {
			const v = await client.query(`SELECT city_id FROM vendors WHERE id = $1`, [order.vendor_id]);
			if (v.rows[0]?.city_id !== cityId) {
				await client.query('ROLLBACK');
				return res.status(403).json({ error: 'Outside city scope' });
			}
		}
		if (!canTransition(order.status, toStatus)) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: `Cannot transition ${order.status} → ${toStatus}` });
		}

		const items = await client.query(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
		const stockAction = stockActionFor(order.status, toStatus);
		if (stockAction) {
			await applyStockForOrderItems(client, items.rows, stockAction);
		}

		await client.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [
			toStatus,
			orderId,
		]);
		await client.query(
			`INSERT INTO order_events (order_id, from_status, to_status, actor_user_id, meta)
			 VALUES ($1, $2, $3, $4, $5::jsonb)`,
			[
				orderId,
				order.status,
				toStatus,
				req.user.id,
				JSON.stringify({ reason: req.body.reason || 'admin_force', admin: true }),
			]
		);
		await enqueueOutbox(client, {
			eventType: `order.${toStatus}`,
			aggregateType: 'order',
			aggregateId: String(orderId),
			payload: { order_id: orderId, from: order.status, to: toStatus, admin: true },
		});
		await client.query('COMMIT');
		return res.json({ order: await loadOrder(orderId) });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('admin.forceTransition', err);
		return res.status(500).json({ error: 'Failed to transition' });
	} finally {
		client.release();
	}
}

export async function getSettings(req, res) {
	try {
		const result = await pool.query(`SELECT key, value, updated_at FROM app_settings ORDER BY key`);
		return res.json({ settings: result.rows });
	} catch (err) {
		console.error('admin.getSettings', err);
		return res.status(500).json({ error: 'Failed to load settings' });
	}
}

export async function putSetting(req, res) {
	try {
		const key = String(req.params.key || '').trim();
		if (!key) return res.status(400).json({ error: 'key required' });
		const value = req.body.value;
		if (value === undefined) return res.status(400).json({ error: 'value required' });
		const result = await pool.query(
			`INSERT INTO app_settings (key, value, updated_at)
			 VALUES ($1, $2::jsonb, NOW())
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
			 RETURNING *`,
			[key, JSON.stringify(value)]
		);
		return res.json({ setting: result.rows[0] });
	} catch (err) {
		console.error('admin.putSetting', err);
		return res.status(500).json({ error: 'Failed to save setting' });
	}
}

export async function upsertInfoPage(req, res) {
	try {
		const slug = String(req.params.slug || '').trim();
		const title = String(req.body.title || '').trim();
		const body = String(req.body.body || '');
		if (!slug || !title) return res.status(400).json({ error: 'slug and title required' });
		const result = await pool.query(
			`INSERT INTO info_pages (slug, title, body, updated_at)
			 VALUES ($1, $2, $3, NOW())
			 ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW()
			 RETURNING *`,
			[slug, title, body]
		);
		return res.json({ page: result.rows[0] });
	} catch (err) {
		console.error('admin.upsertInfoPage', err);
		return res.status(500).json({ error: 'Failed to save page' });
	}
}

export { assertStaff };
