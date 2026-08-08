import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { registerDevice } from '@/src/api/services';

Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowAlert: true,
		shouldPlaySound: true,
		shouldSetBadge: false,
		shouldShowBanner: true,
		shouldShowList: true,
	}),
});

/**
 * Request permission, get Expo push token, register with Grabit API.
 * Safe to call repeatedly; no-ops on web / missing project id / denied permission.
 */
export async function registerForPushNotifications(): Promise<string | null> {
	if (Platform.OS === 'web') return null;
	if (!Device.isDevice) {
		console.info('[push] Skipping — physical device required for Expo push');
		return null;
	}

	const { status: existing } = await Notifications.getPermissionsAsync();
	let finalStatus = existing;
	if (existing !== 'granted') {
		const { status } = await Notifications.requestPermissionsAsync();
		finalStatus = status;
	}
	if (finalStatus !== 'granted') return null;

	const projectId =
		Constants.expoConfig?.extra?.eas?.projectId ??
		Constants.easConfig?.projectId ??
		process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

	const tokenResponse = projectId
		? await Notifications.getExpoPushTokenAsync({ projectId })
		: await Notifications.getExpoPushTokenAsync();

	const token = tokenResponse.data;
	if (!token) return null;

	await registerDevice(token, Platform.OS);
	return token;
}
