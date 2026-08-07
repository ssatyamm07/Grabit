import pool from '../../db.js';

export async function getVendorByUserId(userId, client = pool) {
	const result = await client.query(
		`SELECT v.*, u.phone, u.name AS owner_name
		 FROM vendors v
		 JOIN users u ON u.id = v.user_id
		 WHERE v.user_id = $1`,
		[userId]
	);
	return result.rows[0] || null;
}

export async function requireVendorProfile(req, res, next) {
	try {
		const vendor = await getVendorByUserId(req.user.id);
		if (!vendor) {
			return res.status(403).json({ error: 'Vendor profile required' });
		}
		if (!vendor.is_approved) {
			return res.status(403).json({ error: 'Vendor pending approval' });
		}
		req.vendor = vendor;
		next();
	} catch (err) {
		console.error('requireVendorProfile', err);
		res.status(500).json({ error: 'Failed to load vendor' });
	}
}
