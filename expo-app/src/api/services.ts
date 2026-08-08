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
		products?: Array<{
			id: number;
			name: string;
			brand: string | null;
			category: string | null;
			unit_label: string | null;
		}>;
		items?: Array<{
			id: number;
			name: string;
			brand: string | null;
			category: string | null;
			unit_label: string | null;
		}>;
	}>('/catalog/master/search', { params: { q } });
	return data.products || data.items || [];
}

export async function unifiedSearch(q: string, lat?: number, lng?: number) {
	return api<{
		q: string;
		terms: string[];
		products: Array<Record<string, unknown>>;
		vendors: Array<Record<string, unknown>>;
		services: Array<{
			id: number;
			title: string;
			price_paise: number;
			duration_minutes: number;
			vendor_id: number;
			business_name: string;
		}>;
	}>('/search', {
		params: {
			q,
			...(lat != null && lng != null ? { lat, lng } : {}),
		},
	});
}

export async function listVendors(lat?: number, lng?: number) {
	const data = await api<{
		vendors: Array<{
			id: number;
			business_name: string;
			vendor_type: string;
			listing_count: string | number;
			distance_m?: number;
		}>;
	}>('/vendors', {
		params: lat != null && lng != null ? { lat, lng } : undefined,
	});
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

export async function getOrderTracking(orderId: number) {
	return api<{
		order_id: number;
		status: string;
		fulfillment_mode?: string;
		vendor?: { lat?: number | null; lng?: number | null; business_name?: string };
		job?: {
			partner_lat?: number | null;
			partner_lng?: number | null;
			status?: string;
		} | null;
		eta_meters?: number | null;
		eta?: number | null;
	}>(`/orders/${orderId}/tracking`);
}

export async function listVendorOrders() {
	const data = await api<{ orders: Array<Record<string, unknown>> }>('/orders/vendor');
	return data.orders;
}

export async function transitionOrder(orderId: number, to_status: string) {
	return api<{ order: Record<string, unknown>; delivery_otp?: string }>(
		`/orders/${orderId}/transition`,
		{
			method: 'POST',
			body: { to_status },
		}
	);
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

export async function listMasterServices() {
	const data = await api<{
		services: Array<{
			id: number;
			name: string;
			category: string | null;
			description: string | null;
			unit_label: string | null;
		}>;
	}>('/services/master');
	return data.services;
}

export async function listVendorServices(vendorId: number) {
	const data = await api<{
		services: Array<{
			id: number;
			title: string;
			price_paise: number;
			duration_minutes: number;
			description?: string | null;
			vendor_id: number;
		}>;
	}>(`/services/vendor/${vendorId}`);
	return data.services;
}

export async function createServiceBooking(input: {
	vendor_service_id: number;
	scheduled_start: string;
	notes?: string;
	idempotencyKey: string;
}) {
	return api<{ booking: { id: number; status: string; price_paise: number } }>('/services/bookings', {
		body: {
			vendor_service_id: input.vendor_service_id,
			scheduled_start: input.scheduled_start,
			notes: input.notes,
		},
		idempotencyKey: input.idempotencyKey,
	});
}

export async function listMyBookings() {
	const data = await api<{ bookings: Array<Record<string, unknown>> }>('/services/bookings/me');
	return data.bookings;
}

export async function getPilotAnalytics() {
	return api<{
		acceptance?: Record<string, number>;
		daily?: Array<Record<string, unknown>>;
		fill?: Record<string, number>;
		[key: string]: unknown;
	}>('/analytics/pilot');
}

export async function listDisputes(status?: string) {
	const data = await api<{ disputes: Array<Record<string, unknown>> }>('/disputes', {
		params: status ? { status } : undefined,
	});
	return data.disputes;
}

export async function resolveDispute(id: number, resolution: string, issue_refund?: boolean) {
	return api<{ dispute: Record<string, unknown> }>(`/disputes/${id}/resolve`, {
		method: 'POST',
		body: { status: 'resolved', resolution, issue_refund: !!issue_refund },
	});
}

export async function getVendorMe() {
	return api<{ vendor: Record<string, unknown> & { id: number; is_open: boolean; business_name: string } }>(
		'/vendors/me'
	);
}

export async function patchVendorMe(body: {
	is_open?: boolean;
	business_name?: string;
	coverage_radius_m?: number;
	fulfillment_mode_default?: string;
}) {
	return api<{ vendor: Record<string, unknown> }>('/vendors/me', { method: 'PATCH', body });
}

export async function patchListing(
	id: number,
	body: { price_paise?: number; mrp_paise?: number; is_active?: boolean }
) {
	return api<{ listing: Record<string, unknown> }>(`/vendors/me/listings/${id}`, {
		method: 'PATCH',
		body,
	});
}

export async function patchInventory(id: number, qty: number) {
	return api<{ inventory: Record<string, unknown> }>(`/vendors/me/inventory/${id}`, {
		method: 'PATCH',
		body: { qty },
	});
}

export async function getDeliveryMe() {
	return api<{ partner: Record<string, unknown> }>('/delivery/me');
}

export async function patchDeliveryLocation(lat: number, lng: number) {
	return api<{ partner: Record<string, unknown> }>('/delivery/me/location', {
		method: 'PATCH',
		body: { lat, lng },
	});
}

export async function listDeliveryJobs(status?: string) {
	const data = await api<{ jobs: Array<Record<string, unknown>> }>('/delivery/jobs', {
		params: status ? { status } : undefined,
	});
	return data.jobs;
}

export async function acceptDeliveryJob(jobId: number) {
	return api<{ job: Record<string, unknown> }>(`/delivery/jobs/${jobId}/accept`, {
		method: 'POST',
		body: {},
	});
}

export async function pickupDeliveryJob(jobId: number) {
	return api<{ job: Record<string, unknown>; order: Record<string, unknown> }>(
		`/delivery/jobs/${jobId}/pickup`,
		{ method: 'POST', body: {} }
	);
}

export async function completeDeliveryJob(jobId: number, delivery_otp: string) {
	return api<{ job: Record<string, unknown>; order: Record<string, unknown> }>(
		`/delivery/jobs/${jobId}/complete`,
		{ method: 'POST', body: { delivery_otp } }
	);
}

export async function registerDevice(expo_push_token: string, platform?: string) {
	return api<{ device: Record<string, unknown> }>('/devices/register', {
		method: 'POST',
		body: { expo_push_token, platform: platform || 'unknown' },
	});
}

export async function unregisterDevice(expo_push_token: string) {
	return api<{ ok: boolean }>('/devices/register', {
		method: 'DELETE',
		body: { expo_push_token },
	});
}

export async function createPayment(input: {
	order_id?: number;
	booking_id?: number;
	provider: 'cod' | 'razorpay';
	idempotencyKey?: string;
}) {
	return api<{
		payment: Record<string, unknown>;
		razorpay?: {
			key_id: string;
			razorpay_order_id: string;
			amount: number;
			currency: string;
		};
	}>('/payment/create', {
		method: 'POST',
		body: {
			order_id: input.order_id,
			booking_id: input.booking_id,
			provider: input.provider,
		},
		idempotencyKey: input.idempotencyKey,
	});
}

export async function verifyPayment(input: {
	order_id?: number;
	booking_id?: number;
	razorpay_order_id: string;
	razorpay_payment_id: string;
	razorpay_signature: string;
}) {
	return api<{ payment: Record<string, unknown>; verified: boolean }>('/payment/verify', {
		method: 'POST',
		body: input,
	});
}

export function formatPaise(paise: number) {
	return `₹${(paise / 100).toFixed(2)}`;
}
