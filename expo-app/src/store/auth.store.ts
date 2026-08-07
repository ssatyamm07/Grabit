import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

type User = {
	id: number;
	phone: string;
	name: string | null;
	role: string;
	city_id?: number | null;
};

type AuthState = {
	accessToken: string | null;
	refreshToken: string | null;
	user: User | null;
	hydrated: boolean;
	hydrate: () => Promise<void>;
	setSession: (payload: { accessToken: string; refreshToken: string; user: User }) => Promise<void>;
	logout: () => Promise<void>;
};

const KEY = 'grabit.auth.v1';

export const useAuthStore = create<AuthState>((set) => ({
	accessToken: null,
	refreshToken: null,
	user: null,
	hydrated: false,
	hydrate: async () => {
		try {
			const raw = await AsyncStorage.getItem(KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				set({
					accessToken: parsed.accessToken ?? null,
					refreshToken: parsed.refreshToken ?? null,
					user: parsed.user ?? null,
				});
			}
		} finally {
			set({ hydrated: true });
		}
	},
	setSession: async ({ accessToken, refreshToken, user }) => {
		await AsyncStorage.setItem(KEY, JSON.stringify({ accessToken, refreshToken, user }));
		set({ accessToken, refreshToken, user });
	},
	logout: async () => {
		await AsyncStorage.removeItem(KEY);
		set({ accessToken: null, refreshToken: null, user: null });
	},
}));
