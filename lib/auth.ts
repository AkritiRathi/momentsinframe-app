import * as SecureStore from 'expo-secure-store';

const ORGANISER_SESSION_KEY = 'organiser_session';
const ORGANISER_PASSWORD_KEY = 'organiser_password';

export async function saveOrganiserSession(password: string): Promise<void> {
  await SecureStore.setItemAsync(ORGANISER_SESSION_KEY, 'true');
  await SecureStore.setItemAsync(ORGANISER_PASSWORD_KEY, password);
}

export async function isOrganiser(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(ORGANISER_SESSION_KEY);
  return val === 'true';
}

export async function getOrganiserPassword(): Promise<string | null> {
  return SecureStore.getItemAsync(ORGANISER_PASSWORD_KEY);
}

export async function clearOrganiserSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ORGANISER_SESSION_KEY);
  await SecureStore.deleteItemAsync(ORGANISER_PASSWORD_KEY);
}
