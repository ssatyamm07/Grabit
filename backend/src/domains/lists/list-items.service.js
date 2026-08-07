import pool from '../../db.js';
import { ListError } from './list.errors.js';
import {
	assertCanEditItems,
	getMembership,
} from './lists.service.js';

/** Validate qty for list items */
export function validateQty(qty) {
	const n = Number(qty);
	if (!Number.isInteger(n) || n < 1) {
		throw new ListError('VALIDATION', 'qty must be integer >= 1');
	}
	return n;
}

/**
 * Add item: upsert increases qty when master_product already on list.
 */
export async function addItem(listId, userId, { master_product_id, qty, notes }) {
	const { role } = await getMembership(listId, userId);
	assertCanEditItems(role);

	const masterId = Number(master_product_id);
	if (!Number.isInteger(masterId) || masterId < 1) {
		throw new ListError('VALIDATION', 'master_product_id required');
	}
	const q = validateQty(qty ?? 1);

	const product = await pool.query(`SELECT id FROM master_products WHERE id = $1`, [masterId]);
	if (product.rowCount === 0) {
		throw new ListError('MASTER_NOT_FOUND', 'Master product not found', 404);
	}

	const result = await pool.query(
		`INSERT INTO shopping_list_items (list_id, master_product_id, qty, notes, added_by)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (list_id, master_product_id)
		 DO UPDATE SET
		   qty = shopping_list_items.qty + EXCLUDED.qty,
		   notes = COALESCE(EXCLUDED.notes, shopping_list_items.notes),
		   version = shopping_list_items.version + 1,
		   updated_at = NOW()
		 RETURNING *`,
		[listId, masterId, q, notes ?? null, userId]
	);

	await pool.query(`UPDATE shopping_lists SET updated_at = NOW() WHERE id = $1`, [listId]);
	return result.rows[0];
}

export async function updateItem(listId, userId, itemId, { qty, notes, sort_order, version }) {
	const { role } = await getMembership(listId, userId);
	assertCanEditItems(role);

	const fields = [];
	const values = [];
	let i = 1;

	if (qty != null) {
		fields.push(`qty = $${i++}`);
		values.push(validateQty(qty));
	}
	if (notes !== undefined) {
		fields.push(`notes = $${i++}`);
		values.push(notes);
	}
	if (sort_order != null) {
		fields.push(`sort_order = $${i++}`);
		values.push(Number(sort_order));
	}

	if (!fields.length) throw new ListError('VALIDATION', 'No fields to update');

	fields.push('version = shopping_list_items.version + 1');
	fields.push('updated_at = NOW()');

	values.push(itemId, listId);
	let sql = `UPDATE shopping_list_items SET ${fields.join(', ')}
	            WHERE id = $${i++} AND list_id = $${i++}`;

	if (version != null) {
		sql += ` AND version = $${i++}`;
		values.push(Number(version));
	}

	sql += ' RETURNING *';

	const result = await pool.query(sql, values);
	if (result.rowCount === 0) {
		if (version != null) {
			throw new ListError('VERSION_CONFLICT', 'Item was modified by someone else', 409);
		}
		throw new ListError('ITEM_NOT_FOUND', 'Item not found', 404);
	}

	await pool.query(`UPDATE shopping_lists SET updated_at = NOW() WHERE id = $1`, [listId]);
	return result.rows[0];
}

export async function removeItem(listId, userId, itemId) {
	const { role } = await getMembership(listId, userId);
	assertCanEditItems(role);

	const result = await pool.query(
		`DELETE FROM shopping_list_items WHERE id = $1 AND list_id = $2 RETURNING *`,
		[itemId, listId]
	);
	if (result.rowCount === 0) {
		throw new ListError('ITEM_NOT_FOUND', 'Item not found', 404);
	}
	await pool.query(`UPDATE shopping_lists SET updated_at = NOW() WHERE id = $1`, [listId]);
	return result.rows[0];
}

export async function loadListItems(listId, client = pool) {
	const result = await client.query(
		`SELECT i.id AS item_id, i.master_product_id, i.qty, i.notes,
		        mp.name AS product_name, mp.brand, mp.unit_label
		 FROM shopping_list_items i
		 JOIN master_products mp ON mp.id = i.master_product_id
		 WHERE i.list_id = $1
		 ORDER BY i.sort_order ASC, i.id ASC`,
		[listId]
	);
	return result.rows;
}
