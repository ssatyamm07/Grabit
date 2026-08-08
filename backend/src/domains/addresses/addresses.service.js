import pool from '../../db.js';

function mapAddress(row) {
	if (!row) return null;
	return {
		id: row.id,
		user_id: row.user_id,
		label: row.label,
		street: row.street,
		house_details: row.house_details,
		landmark: row.landmark,
		area: row.area,
		pincode: row.pincode,
		city_id: row.city_id,
		lat: row.lat != null ? Number(row.lat) : null,
		lng: row.lng != null ? Number(row.lng) : null,
		is_default: row.is_default,
		created_at: row.created_at,
	};
}

const SELECT = `
	SELECT a.*,
	       ST_Y(a.location::geometry) AS lat,
	       ST_X(a.location::geometry) AS lng
	FROM addresses a
`;

export async function listAddresses(userId) {
	const result = await pool.query(
		`${SELECT} WHERE a.user_id = $1 ORDER BY a.is_default DESC, a.id DESC`,
		[userId]
	);
	return result.rows.map(mapAddress);
}

export async function getAddress(userId, addressId) {
	const result = await pool.query(`${SELECT} WHERE a.id = $1 AND a.user_id = $2`, [
		addressId,
		userId,
	]);
	return mapAddress(result.rows[0]);
}

export async function createAddress(userId, body) {
	const lat = Number(body.lat);
	const lng = Number(body.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		const err = new Error('lat and lng required');
		err.status = 400;
		throw err;
	}

	const isDefault = Boolean(body.is_default);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		if (isDefault) {
			await client.query(`UPDATE addresses SET is_default = FALSE WHERE user_id = $1`, [userId]);
		}

		const result = await client.query(
			`INSERT INTO addresses (
				user_id, label, street, house_details, landmark, area, pincode, city_id, location, is_default
			 ) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8,
				ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
				$11
			 )
			 RETURNING id`,
			[
				userId,
				body.label || null,
				body.street || null,
				body.house_details || null,
				body.landmark || null,
				body.area || null,
				body.pincode || null,
				body.city_id || null,
				lng,
				lat,
				isDefault,
			]
		);
		await client.query('COMMIT');
		return getAddress(userId, result.rows[0].id);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function updateAddress(userId, addressId, body) {
	const existing = await getAddress(userId, addressId);
	if (!existing) {
		const err = new Error('Address not found');
		err.status = 404;
		throw err;
	}

	const lat = body.lat != null ? Number(body.lat) : existing.lat;
	const lng = body.lng != null ? Number(body.lng) : existing.lng;
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		const err = new Error('lat and lng required');
		err.status = 400;
		throw err;
	}

	const isDefault = body.is_default != null ? Boolean(body.is_default) : existing.is_default;
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		if (isDefault) {
			await client.query(`UPDATE addresses SET is_default = FALSE WHERE user_id = $1`, [userId]);
		}

		await client.query(
			`UPDATE addresses SET
				label = $1,
				street = $2,
				house_details = $3,
				landmark = $4,
				area = $5,
				pincode = $6,
				city_id = $7,
				location = ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
				is_default = $10
			 WHERE id = $11 AND user_id = $12`,
			[
				body.label !== undefined ? body.label : existing.label,
				body.street !== undefined ? body.street : existing.street,
				body.house_details !== undefined ? body.house_details : existing.house_details,
				body.landmark !== undefined ? body.landmark : existing.landmark,
				body.area !== undefined ? body.area : existing.area,
				body.pincode !== undefined ? body.pincode : existing.pincode,
				body.city_id !== undefined ? body.city_id : existing.city_id,
				lng,
				lat,
				isDefault,
				addressId,
				userId,
			]
		);
		await client.query('COMMIT');
		return getAddress(userId, addressId);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function deleteAddress(userId, addressId) {
	const result = await pool.query(
		`DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id`,
		[addressId, userId]
	);
	if (result.rowCount === 0) {
		const err = new Error('Address not found');
		err.status = 404;
		throw err;
	}
}

export async function setDefaultAddress(userId, addressId) {
	const existing = await getAddress(userId, addressId);
	if (!existing) {
		const err = new Error('Address not found');
		err.status = 404;
		throw err;
	}
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(`UPDATE addresses SET is_default = FALSE WHERE user_id = $1`, [userId]);
		await client.query(
			`UPDATE addresses SET is_default = TRUE WHERE id = $1 AND user_id = $2`,
			[addressId, userId]
		);
		await client.query('COMMIT');
		return getAddress(userId, addressId);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}
