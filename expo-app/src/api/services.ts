import { api, newIdempotencyKey } from './http-client';

export { newIdempotencyKey };

export async function sendOtp(phone: string) {
	return api<{ ok: boolean; message: string; dev_otp?: string }>('/auth/send-otp', {
		body: { phone },
	});
}

export async function verifyOtp(phone: string, otp: string) {
	return api<{
		accessToken: string;
		refreshToken: string;
		user: { id: number; phone: string; name: string | null; role: string; city_id: number | null };
	}>('/auth/verify-otp', { body: { phone, otp } });
}

export async function searchCatalog(q: string) {
	const data = await api<{
		items: Array<{
			id: number;
			name: string;
			brand: string | null;
			category: string | null;
			unit_label: string | null;
		}>;
	}>('/catalog/master/search', { params: { q } });
	return data.items;
}

export async function listVendors() {
	const data = await api<{
		vendors: Array<{
			id: number;
			business_name: string;
			vendor_type: string;
			listing_count: string | number;
		}>;
	}>('/vendors');
	return data.vendors;
}

export async function getStorefront(vendorId: number) {
	const data = await api<{
		items: Array<{
			listing_id: number;
			name: string;
			brand: string | null;
			unit_label: string | null;
			price_paise: number;
			available_qty: number;
		}>;
	}>(`/vendors/${vendorId}/storefront`);
	return data.items;
}

export async function placeOrder(input: {
	vendor_id: number;
	items: Array<{ listing_id: number; qty: number }>;
	payment_method?: string;
	idempotencyKey: string;
}) {
	return api<{ order: { id: number; status: string; total_paise: number } }>('/orders', {
		body: {
			vendor_id: input.vendor_id,
			items: input.items,
			payment_method: input.payment_method || 'cod',
		},
		idempotencyKey: input.idempotencyKey,
	});
}

export async function listMyOrders() {
	const data = await api<{ orders: Array<Record<string, unknown>> }>('/orders/me');
	return data.orders;
}

export async function listVendorOrders() {
	const data = await api<{ orders: Array<Record<string, unknown>> }>('/orders/vendor');
	return data.orders;
}

export async function transitionOrder(orderId: number, to_status: string) {
	return api<{ order: Record<string, unknown> }>(`/orders/${orderId}/transition`, {
		method: 'POST',
		body: { to_status },
	});
}

export async function listMyListings() {
	const data = await api<{
		vendor_id: number;
		listings: Array<{
			id: number;
			name: string;
			brand: string | null;
			price_paise: number;
			qty: number;
			reserved_qty: number;
			available_qty: number;
			master_product_id: number;
		}>;
	}>('/vendors/me/listings');
	return data;
}

export async function createListing(input: {
	master_product_id: number;
	price_paise: number;
	qty: number;
}) {
	return api<{ listing: { id: number }; qty: number }>('/vendors/me/listings', {
		body: input,
	});
}

export async function getLedger() {
	return api<{ account_ref: string; balance_paise: number; entries: unknown[] }>('/ledger/me');
}

export function formatPaise(paise: number) {
	return `₹${(paise / 100).toFixed(2)}`;
}
