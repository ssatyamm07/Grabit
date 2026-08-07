/** Allowed order status transitions */
export const ORDER_TRANSITIONS = {
	draft: ['placed', 'cancelled'],
	placed: ['accepted', 'rejected', 'expired', 'cancelled'],
	accepted: ['preparing', 'cancelled'],
	preparing: ['ready', 'cancelled'],
	ready: ['picked', 'cancelled'],
	picked: ['delivered'],
	delivered: ['returned'],
	cancelled: [],
	rejected: [],
	expired: [],
	refunded: [],
	returned: ['refunded'],
};

export function canTransition(from, to) {
	return (ORDER_TRANSITIONS[from] || []).includes(to);
}

/** Stock side-effects for a transition */
export function stockActionFor(from, to) {
	if (from === 'draft' && to === 'placed') return 'reserve';
	if (from === 'placed' && to === 'accepted') return 'commit';
	if (from === 'placed' && ['rejected', 'expired', 'cancelled'].includes(to)) return 'release';
	if (['accepted', 'preparing', 'ready'].includes(from) && to === 'cancelled') return 'restock';
	return null;
}
