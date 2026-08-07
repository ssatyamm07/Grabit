/**
 * Inventory helpers — run inside an open transaction.
 * available = qty - reserved_qty
 */

export async function reserveStock(client, listingId, qty) {
	const result = await client.query(
		`UPDATE vendor_inventory
		 SET reserved_qty = reserved_qty + $2, updated_at = NOW()
		 WHERE vendor_listing_id = $1
		   AND qty - reserved_qty >= $2
		 RETURNING *`,
		[listingId, qty]
	);
	if (result.rowCount === 0) {
		const err = new Error('Insufficient stock to reserve');
		err.code = 'STOCK_UNAVAILABLE';
		err.listingId = listingId;
		throw err;
	}
	return result.rows[0];
}

export async function commitStock(client, listingId, qty) {
	const result = await client.query(
		`UPDATE vendor_inventory
		 SET qty = qty - $2,
		     reserved_qty = reserved_qty - $2,
		     updated_at = NOW()
		 WHERE vendor_listing_id = $1
		   AND reserved_qty >= $2
		   AND qty >= $2
		 RETURNING *`,
		[listingId, qty]
	);
	if (result.rowCount === 0) {
		const err = new Error('Failed to commit stock');
		err.code = 'STOCK_COMMIT_FAILED';
		throw err;
	}
	return result.rows[0];
}

export async function releaseReserved(client, listingId, qty) {
	const result = await client.query(
		`UPDATE vendor_inventory
		 SET reserved_qty = reserved_qty - $2, updated_at = NOW()
		 WHERE vendor_listing_id = $1 AND reserved_qty >= $2
		 RETURNING *`,
		[listingId, qty]
	);
	if (result.rowCount === 0) {
		const err = new Error('Failed to release stock');
		err.code = 'STOCK_RELEASE_FAILED';
		throw err;
	}
	return result.rows[0];
}

/** After accept then cancel — put committed qty back */
export async function restockCommitted(client, listingId, qty) {
	const result = await client.query(
		`UPDATE vendor_inventory
		 SET qty = qty + $2, updated_at = NOW()
		 WHERE vendor_listing_id = $1
		 RETURNING *`,
		[listingId, qty]
	);
	if (result.rowCount === 0) {
		const err = new Error('Failed to restock');
		err.code = 'STOCK_RESTOCK_FAILED';
		throw err;
	}
	return result.rows[0];
}

export async function applyStockForOrderItems(client, items, action) {
	for (const item of items) {
		if (!item.vendor_listing_id) continue;
		if (action === 'reserve') await reserveStock(client, item.vendor_listing_id, item.qty);
		else if (action === 'commit') await commitStock(client, item.vendor_listing_id, item.qty);
		else if (action === 'release') await releaseReserved(client, item.vendor_listing_id, item.qty);
		else if (action === 'restock') await restockCommitted(client, item.vendor_listing_id, item.qty);
	}
}
