import { create } from 'zustand';

type Toast = { id: number; message: string; tone?: 'info' | 'success' | 'error' };

type ToastState = {
	toasts: Toast[];
	show: (message: string, tone?: Toast['tone']) => void;
	dismiss: (id: number) => void;
};

let seq = 1;

export const useToastStore = create<ToastState>((set) => ({
	toasts: [],
	show: (message, tone = 'info') => {
		const id = seq++;
		set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
		setTimeout(() => {
			set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
		}, 2600);
	},
	dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
