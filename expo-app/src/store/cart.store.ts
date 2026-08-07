import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type CartLine = {
	listing_id: number;
	vendor_id: number;
	vendor_name: string;
	name: string;
	price_paise: number;
	qty: number;
	available_qty: number;
};

type CartState = {
	lines: CartLine[];
	hydrated: boolean;
	hydrate: () => Promise<void>;
	add: (line: Omit<CartLine, 'qty'>, qty?: number) => void;
	setQty: (listing_id: number, qty: number) => void;
	remove: (listing_id: number) => void;
	clear: () => void;
	totalQuantity: () => number;
	subtotalPaise: () => number;
	vendorId: () => number | null;
};

const KEY = 'grabit.cart.v1';

async function persist(lines: CartLine[]) {
	await AsyncStorage.setItem(KEY, JSON.stringify(lines));
}

export const useCartStore = create<CartState>((set, get) => ({
	lines: [],
	hydrated: false,
	hydrate: async () => {
		try {
			const raw = await AsyncStorage.getItem(KEY);
			if (raw) set({ lines: JSON.parse(raw) as CartLine[] });
		} finally {
			set({ hydrated: true });
		}
	},
	add: (line, qty = 1) => {
		const current = get().lines;
		const vendorId = current[0]?.vendor_id;
		if (vendorId && vendorId !== line.vendor_id) {
			// One vendor per cart (hyperlocal MVP)
			const next = [{ ...line, qty: Math.min(qty, line.available_qty) }];
			set({ lines: next });
			void persist(next);
			return;
		}
		const existing = current.find((l) => l.listing_id === line.listing_id);
		let next: CartLine[];
		if (existing) {
			next = current.map((l) =>
				l.listing_id === line.listing_id
					? { ...l, qty: Math.min(l.qty + qty, line.available_qty), available_qty: line.available_qty }
					: l
			);
		} else {
			next = [...current, { ...line, qty: Math.min(qty, line.available_qty) }];
		}
		set({ lines: next });
		void persist(next);
	},
	setQty: (listing_id, qty) => {
		const next =
			qty <= 0
				? get().lines.filter((l) => l.listing_id !== listing_id)
				: get().lines.map((l) =>
						l.listing_id === listing_id ? { ...l, qty: Math.min(qty, l.available_qty) } : l
					);
		set({ lines: next });
		void persist(next);
	},
	remove: (listing_id) => {
		const next = get().lines.filter((l) => l.listing_id !== listing_id);
		set({ lines: next });
		void persist(next);
	},
	clear: () => {
		set({ lines: [] });
		void persist([]);
	},
	totalQuantity: () => get().lines.reduce((n, l) => n + l.qty, 0),
	subtotalPaise: () => get().lines.reduce((n, l) => n + l.price_paise * l.qty, 0),
	vendorId: () => get().lines[0]?.vendor_id ?? null,
}));
