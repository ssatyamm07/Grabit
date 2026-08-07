import * as lists from './lists.service.js';
import * as items from './list-items.service.js';
import * as checkout from './checkout.service.js';
import { toHttp, ListError } from './list.errors.js';

function handle(res, err) {
	const mapped = toHttp(err);
	if (mapped) return res.status(mapped.status).json(mapped.body);
	console.error(err);
	return res.status(500).json({ error: 'Internal server error' });
}

export async function createList(req, res) {
	try {
		const list = await lists.createList({
			ownerUserId: req.user.id,
			name: req.body.name,
			listType: req.body.list_type,
		});
		return res.status(201).json({ list });
	} catch (err) {
		return handle(res, err);
	}
}

export async function getLists(req, res) {
	try {
		const rows = await lists.listListsForUser(req.user.id);
		return res.json({ lists: rows });
	} catch (err) {
		return handle(res, err);
	}
}

export async function getList(req, res) {
	try {
		const detail = await lists.getListDetail(Number(req.params.id), req.user.id);
		return res.json(detail);
	} catch (err) {
		return handle(res, err);
	}
}

export async function patchList(req, res) {
	try {
		const list = await lists.updateList(Number(req.params.id), req.user.id, {
			name: req.body.name,
			listType: req.body.list_type,
		});
		return res.json({ list });
	} catch (err) {
		return handle(res, err);
	}
}

export async function archiveList(req, res) {
	try {
		const list = await lists.archiveList(Number(req.params.id), req.user.id);
		return res.json({ list });
	} catch (err) {
		return handle(res, err);
	}
}

export async function addItem(req, res) {
	try {
		const item = await items.addItem(Number(req.params.id), req.user.id, req.body);
		return res.status(201).json({ item });
	} catch (err) {
		return handle(res, err);
	}
}

export async function patchItem(req, res) {
	try {
		const item = await items.updateItem(
			Number(req.params.id),
			req.user.id,
			Number(req.params.itemId),
			req.body
		);
		return res.json({ item });
	} catch (err) {
		return handle(res, err);
	}
}

export async function deleteItem(req, res) {
	try {
		const item = await items.removeItem(
			Number(req.params.id),
			req.user.id,
			Number(req.params.itemId)
		);
		return res.json({ item });
	} catch (err) {
		return handle(res, err);
	}
}

export async function addMember(req, res) {
	try {
		const result = await lists.addMemberByPhone(
			Number(req.params.id),
			req.user.id,
			req.body.phone,
			req.body.role || 'editor'
		);
		return res.status(201).json(result);
	} catch (err) {
		return handle(res, err);
	}
}

export async function removeMember(req, res) {
	try {
		const member = await lists.removeMember(
			Number(req.params.id),
			req.user.id,
			Number(req.params.userId)
		);
		return res.json({ member });
	} catch (err) {
		return handle(res, err);
	}
}

export async function previewCheckout(req, res) {
	try {
		const preview = await checkout.previewCheckout(Number(req.params.id), req.user.id, req.body);
		return res.json(preview);
	} catch (err) {
		return handle(res, err);
	}
}

export async function confirmCheckout(req, res) {
	try {
		const result = await checkout.confirmCheckout(
			Number(req.params.id),
			req.user.id,
			{
				preview_token: req.body.preview_token,
				payment_method: req.body.payment_method,
			},
			req.idempotencyKey
		);
		return res.status(result.replayed ? 200 : 201).json(result);
	} catch (err) {
		if (err instanceof ListError && err.code === 'PREVIEW_STALE') {
			return res.status(409).json({ error: err.message, code: err.code, ...err.extra });
		}
		return handle(res, err);
	}
}
