import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEYS = {
  FIRST_NAME: 'user_first_name',
  LAST_NAME: 'user_last_name',
  MOBILE: 'user_mobile',
  LAST_EVENT_CODE: 'last_event_code',
  EVENT_USER_ID: 'event_user_id',
};

export type UserProfile = {
  firstName: string;
  lastName: string;
  mobile: string;
};

export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'android') {
    return Application.getAndroidId() ?? 'unknown-android';
  }
  return (await Application.getIosIdForVendorAsync()) ?? 'unknown-ios';
}

export async function saveEventUserId(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.EVENT_USER_ID, id);
}

export async function getEventUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.EVENT_USER_ID);
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(KEYS.FIRST_NAME, profile.firstName.trim());
  await SecureStore.setItemAsync(KEYS.LAST_NAME, profile.lastName.trim());
  await SecureStore.setItemAsync(KEYS.MOBILE, profile.mobile.trim());
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const firstName = await SecureStore.getItemAsync(KEYS.FIRST_NAME);
  const lastName = await SecureStore.getItemAsync(KEYS.LAST_NAME);
  const mobile = await SecureStore.getItemAsync(KEYS.MOBILE);

  if (!firstName || !lastName || !mobile) return null;
  return { firstName, lastName, mobile };
}

export async function saveLastEventCode(code: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.LAST_EVENT_CODE, code);
}

export async function getLastEventCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.LAST_EVENT_CODE);
}


export async function clearUserProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.FIRST_NAME);
  await SecureStore.deleteItemAsync(KEYS.LAST_NAME);
  await SecureStore.deleteItemAsync(KEYS.MOBILE);
}

// ── Last Event ────────────────────────────────────────────────────────────────

export type SavedEventParams = {
  slug: string;
  name: string;
  expiresAt: string;
  createdAt: string;
  isAdmin: string;
};

export async function saveLastEvent(params: SavedEventParams): Promise<void> {
  try {
    await SecureStore.setItemAsync('last_event_params', JSON.stringify(params));
  } catch {}
}

export async function getLastEvent(): Promise<SavedEventParams | null> {
  try {
    const raw = await SecureStore.getItemAsync('last_event_params');
    if (!raw) return null;
    return JSON.parse(raw) as SavedEventParams;
  } catch { return null; }
}

export async function clearLastEvent(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync('last_event_params');
  } catch {}
}

// ── Upload Notifications ──────────────────────────────────────────────────────

export type UploadNotificationEntry = {
  status: 'success' | 'duplicate' | 'upgraded' | 'failed' | 'cancelled';
  section: 'main' | 'other' | null;
  existingPhotoId?: string;
  newPhotoId?: string;
  uri: string;
  filename: string;
};

export type UploadNotification = {
  id: string;
  timestamp: string;
  source: 'individual' | 'by_date';
  photosAdded: number;
  duplicatesSkipped: number;
  upgradesFound: number;
  failedCount: number;
  preSkipped?: number; // by_date only: photos skipped because already uploaded
  duplicateData: UploadNotificationEntry[];
  failedData: UploadNotificationEntry[];
  uploadDate?: string; // ISO string, by_date uploads only
  read: boolean;
};

function notifKey(slug: string) {
  return `upload_notifications_${slug}`;
}

export async function saveUploadNotification(slug: string, notif: Omit<UploadNotification, 'id' | 'read'>): Promise<void> {
  try {
    const existing = await getUploadNotifications(slug);
    const entry: UploadNotification = { ...notif, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, read: false };
    await AsyncStorage.setItem(notifKey(slug), JSON.stringify([entry, ...existing]));
  } catch {}
}

export async function getUploadNotifications(slug: string): Promise<UploadNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(notifKey(slug));
    if (!raw) return [];
    return JSON.parse(raw) as UploadNotification[];
  } catch { return []; }
}

export async function markNotificationsRead(slug: string): Promise<void> {
  try {
    const existing = await getUploadNotifications(slug);
    const updated = existing.map(n => ({ ...n, read: true }));
    await AsyncStorage.setItem(notifKey(slug), JSON.stringify(updated));
  } catch {}
}

export async function deleteUploadNotification(slug: string, id: string): Promise<void> {
  try {
    const existing = await getUploadNotifications(slug);
    const updated = existing.filter(n => n.id !== id);
    await AsyncStorage.setItem(notifKey(slug), JSON.stringify(updated));
  } catch {}
}

export async function hasUnreadNotifications(slug: string): Promise<boolean> {
  const notifs = await getUploadNotifications(slug);
  return notifs.some(n => !n.read);
}

export async function mergeUploadNotification(
  slug: string,
  id: string,
  retry: Omit<UploadNotification, 'id' | 'read' | 'timestamp' | 'source' | 'uploadDate'>,
): Promise<void> {
  try {
    const existing = await getUploadNotifications(slug);
    const updated = existing.map(n => {
      if (n.id !== id) return n;
      return {
        ...n,
        photosAdded: n.photosAdded + retry.photosAdded,
        duplicatesSkipped: n.duplicatesSkipped + retry.duplicatesSkipped,
        upgradesFound: n.upgradesFound + retry.upgradesFound,
        failedCount: retry.failedCount,
        duplicateData: [...n.duplicateData, ...retry.duplicateData],
        failedData: retry.failedData,
      };
    });
    await AsyncStorage.setItem(notifKey(slug), JSON.stringify(updated));
  } catch {}
}
