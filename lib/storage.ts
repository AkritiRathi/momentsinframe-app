import * as SecureStore from 'expo-secure-store';

const KEYS = {
  FIRST_NAME: 'user_first_name',
  LAST_NAME: 'user_last_name',
  MOBILE: 'user_mobile',
};

export type UserProfile = {
  firstName: string;
  lastName: string;
  mobile: string;
};

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

export async function clearUserProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.FIRST_NAME);
  await SecureStore.deleteItemAsync(KEYS.LAST_NAME);
  await SecureStore.deleteItemAsync(KEYS.MOBILE);
}
