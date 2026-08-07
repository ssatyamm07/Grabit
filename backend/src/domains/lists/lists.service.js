import pool from '../../db.js';
import { ListError } from './list.errors.js';

export const LIST_TYPES = ['grocery', 'pooja', 'dairy', 'vegetables', 'custom'];

/**
 * Resolve membership role for user on list. Owner always has role owner.
 */
export async function getMembership(listId, userId, client = pool) {
	const list = await client.query(
		`SELECT * FROM shopping_lists WHERE id = $1`,
		[listId]
	);
	if (list.rowCount === 0) {
		throw new ListError('LIST_NOT_FOUND', 'List not found', 404);
	}

	const row = list.rows[0];
	if (row.owner_user_id === userId) {
		return { list: row, role: 'owner' };
	}

	const member = await client.query(
		`SELECT role FROM shopping_list_members WHERE list_id = $1 AND user_id = $2`,
		[listId, userId]
	);
	if (member.rowCount === 0) {
		throw new ListError('FORBIDDEN', 'Not a member of this list', 403);
	}

	return { list: row, role: member.rows[0].role };
}

export function assertCanRead(role) {
	if (!['owner', 'editor', 'viewer'].includes(role)) {
		throw new ListError('FORBIDDEN', 'Forbidden', 403);
	}
}

export function assertCanEditItems(role) {
	if (!['owner', 'editor'].includes(role)) {
		throw new ListError('FORBIDDEN', 'Editors and owners only', 403);
	}
}

export function assertCanManageMembers(role) {
	if (role !== 'owner') {
		throw new ListError('FORBIDDEN', 'Owner only', 403);
	}
}

export function assertCanCheckout(role) {
	if (!['owner', 'editor'].includes(role)) {
		throw new ListError('FORBIDDEN', 'Viewers cannot checkout', 403);
	}
}

export async function createList({ ownerUserId, name, listType }) {
	if (!name || String(name).trim().length < 1) {
		throw new ListError('VALIDATION', 'name required');
	}
	const type = listType || 'grocery';
	if (!LIST_TYPES.includes(type)) {
		throw new ListError('VALIDATION', `list_type must be one of ${LIST_TYPES.join(',')}`);
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query(
			`INSERT INTO shopping_lists (owner_user_id, name, list_type)
			 VALUES ($1, $2, $3)
			 RETURNING *`,
			[ownerUserId, String(name).trim(), type]
		);
		const list = result.rows[0];
		await client.query(
			`INSERT INTO shopping_list_members (list_id, user_id, role)
			 VALUES ($1, $2, 'owner')`,
			[list.id, ownerUserId]
		);
		await client.query('COMMIT');
		return list;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function listListsForUser(userId) {
	const result = await pool.query(
		`SELECT DISTINCT sl.*
		 FROM shopping_lists sl
		 LEFT JOIN shopping_list_members m ON m.list_id = sl.id
		 WHERE sl.owner_user_id = $1 OR m.user_id = $1
		 ORDER BY sl.updated_at DESC`,
		[userId]
	);
	return result.rows;
}

export async function getListDetail(listId, userId) {
	const { list, role } = await getMembership(listId, userId);
	assertCanRead(role);

	const items = await pool.query(
		`SELECT i.*, mp.name AS product_name, mp.brand, mp.unit_label, mp.category, mp.barcode
		 FROM shopping_list_items i
		 JOIN master_products mp ON mp.id = i.master_product_id
		 WHERE i.list_id = $1
		 ORDER BY i.sort_order ASC, i.id ASC`,
		[listId]
	);

	const members = await pool.query(
		`SELECT m.user_id, m.role, u.phone, u.name
		 FROM shopping_list_members m
		 JOIN users u ON u.id = m.user_id
		 WHERE m.list_id = $1
		 ORDER BY m.role ASC, m.id ASC`,
		[listId]
	);

	return { list, role, items: items.rows, members: members.rows };
}

export async function updateList(listId, userId, { name, listType }) {
	const { role } = await getMembership(listId, userId);
	assertCanManageMembers(role); // owner only for rename/type

	const fields = [];
	const values = [];
	let i = 1;
	if (name != null) {
		fields.push(`name = $${i++}`);
		values.push(String(name).trim());
	}
	if (listType != null) {
		if (!LIST_TYPES.includes(listType)) {
			throw new ListError('VALIDATION', `list_type must be one of ${LIST_TYPES.join(',')}`);
		}
		fields.push(`list_type = $${i++}`);
		values.push(listType);
	}
	if (!fields.length) throw new ListError('VALIDATION', 'No fields to update');

	fields.push('updated_at = NOW()');
	values.push(listId);
	const result = await pool.query(
		`UPDATE shopping_lists SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
		values
	);
	return result.rows[0];
}

export async function archiveList(listId, userId) {
	const { role } = await getMembership(listId, userId);
	assertCanManageMembers(role);

	const result = await pool.query(
		`UPDATE shopping_lists SET status = 'archived', updated_at = NOW()
		 WHERE id = $1 RETURNING *`,
		[listId]
	);
	return result.rows[0];
}

export async function addMemberByPhone(listId, ownerUserId, phone, role = 'editor') {
	const { role: myRole } = await getMembership(listId, ownerUserId);
	assertCanManageMembers(myRole);

	if (!['editor', 'viewer'].includes(role)) {
		throw new ListError('VALIDATION', 'role must be editor or viewer');
	}

	const normalized = String(phone || '').replace(/\D/g, '');
	if (normalized.length < 10) {
		throw new ListError('VALIDATION', 'Valid phone required');
	}

	let user = await pool.query(`SELECT id, phone, name, role FROM users WHERE phone = $1`, [normalized]);
	if (user.rowCount === 0) {
		user = await pool.query(
			`INSERT INTO users (phone, role, phone_verified)
			 VALUES ($1, 'customer', FALSE)
			 RETURNING id, phone, name, role`,
			[normalized]
		);
	}

	const userId = user.rows[0].id;
	if (userId === ownerUserId) {
		throw new ListError('VALIDATION', 'Owner is already a member');
	}

	try {
		const result = await pool.query(
			`INSERT INTO shopping_list_members (list_id, user_id, role)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (list_id, user_id) DO UPDATE SET role = EXCLUDED.role
			 RETURNING *`,
			[listId, userId, role]
		);
		await pool.query(`UPDATE shopping_lists SET updated_at = NOW() WHERE id = $1`, [listId]);
		return { member: result.rows[0], user: user.rows[0] };
	} catch (err) {
		throw err;
	}
}

export async function removeMember(listId, ownerUserId, targetUserId) {
	const { list, role } = await getMembership(listId, ownerUserId);
	assertCanManageMembers(role);

	if (targetUserId === list.owner_user_id) {
		throw new ListError('VALIDATION', 'Cannot remove list owner', 400);
	}

	const result = await pool.query(
		`DELETE FROM shopping_list_members
		 WHERE list_id = $1 AND user_id = $2 AND role != 'owner'
		 RETURNING *`,
		[listId, targetUserId]
	);
	if (result.rowCount === 0) {
		throw new ListError('MEMBER_NOT_FOUND', 'Member not found', 404);
	}
	return result.rows[0];
}
