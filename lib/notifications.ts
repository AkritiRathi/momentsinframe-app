import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('uploads', {
      name: 'Upload Progress',
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
    });
    await Notifications.setNotificationChannelAsync('downloads', {
      name: 'Download Progress',
      importance: Notifications.AndroidImportance.DEFAULT,
      showBadge: false,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function showUploadCompleteNotification(summary: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Upload complete',
        body: summary,
        ...(Platform.OS === 'android' && { channelId: 'uploads' }),
      },
      trigger: null,
    });
  } catch { /* notifications may not be granted */ }
}

export async function showDownloadCompleteNotification(message: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Download complete',
        body: message,
        ...(Platform.OS === 'android' && { channelId: 'downloads' }),
      },
      trigger: null,
    });
  } catch { /* notifications may not be granted */ }
}
