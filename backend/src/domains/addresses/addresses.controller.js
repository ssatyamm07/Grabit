import * as svc from './addresses.service.js';

export async function list(req, res) {
	try {
		const addresses = await svc.listAddresses(req.user.id);
		return res.json({ addresses });
	} catch (err) {
		console.error('addresses.list', err);
		return res.status(500).json({ error: 'Failed to list addresses' });
	}
}

export async function get(req, res) {
	try {
		const address = await svc.getAddress(req.user.id, Number(req.params.id));
		if (!address) return res.status(404).json({ error: 'Address not found' });
		return res.json({ address });
	} catch (err) {
		console.error('addresses.get', err);
		return res.status(500).json({ error: 'Failed to load address' });
	}
}

export async function create(req, res) {
	try {
		const address = await svc.createAddress(req.user.id, req.body);
		return res.status(201).json({ address });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.create', err);
		return res.status(500).json({ error: 'Failed to create address' });
	}
}

export async function update(req, res) {
	try {
		const address = await svc.updateAddress(req.user.id, Number(req.params.id), req.body);
		return res.json({ address });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.update', err);
		return res.status(500).json({ error: 'Failed to update address' });
	}
}

export async function remove(req, res) {
	try {
		await svc.deleteAddress(req.user.id, Number(req.params.id));
		return res.json({ ok: true });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		console.error('addresses.remove', err);
		return res.status(500).json({ error: 'Failed to delete address' });
	}
}
