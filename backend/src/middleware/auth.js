import jwt from 'jsonwebtoken';

const ROLES = [
	'customer',
	'vendor',
	'delivery',
	'regional_admin',
	'super_admin',
	'support',
	'field_agent',
];

export function authenticateToken(req, res, next) {
	const authHeader = req.headers.authorization;
	let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (!token && req.cookies?.auth_token) {
		token = req.cookies.auth_token;
	}

	if (!token) {
		return res.status(401).json({ error: 'Access token required' });
	}

	try {
		req.user = jwt.verify(token, process.env.JWT_SECRET);
		next();
	} catch {
		return res.status(403).json({ error: 'Invalid or expired token' });
	}
}

export function requireRole(...allowed) {
	const set = new Set(allowed);
	return (req, res, next) => {
		if (!req.user?.role || !set.has(req.user.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}
		next();
	};
}

export function requireCityScope(req, res, next) {
	const scoped = ['regional_admin', 'field_agent'];
	if (!scoped.includes(req.user?.role)) return next();
	if (!req.user.city_id) {
		return res.status(403).json({ error: 'City scope required for this role' });
	}
	next();
}

export { ROLES };
