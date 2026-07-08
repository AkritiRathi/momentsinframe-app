import * as SecureStore from 'expo-secure-store';

const ORGANISER_PASSWORD_KEY = 'organiser_password';
const ORGANISER_LOGIN_COUNT_KEY = 'organiser_login_count';

const MAX_SILENT_LOGINS = 10;

export async function saveOrganiserSession(password: string): Promise<void> {
  await SecureStore.setItemAsync(ORGANISER_PASSWORD_KEY, password);
  await SecureStore.setItemAsync(ORGANISER_LOGIN_COUNT_KEY, '0');
}

// Returns password if session is still valid, null if expired or not set.
// Increments the silent login counter each call — after MAX_SILENT_LOGINS, clears session.
export async function getOrganiserPassword(): Promise<string | null> {
  const password = await SecureStore.getItemAsync(ORGANISER_PASSWORD_KEY);
  if (!password) return null;

  const count = parseInt((await SecureStore.getItemAsync(ORGANISER_LOGIN_COUNT_KEY)) ?? '0', 10);
  if (count >= MAX_SILENT_LOGINS) {
    await clearOrganiserSession();
    return null;
  }

  await SecureStore.setItemAsync(ORGANISER_LOGIN_COUNT_KEY, (count + 1).toString());
  return password;
}

export async function clearOrganiserSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ORGANISER_PASSWORD_KEY);
  await SecureStore.deleteItemAsync(ORGANISER_LOGIN_COUNT_KEY);
}
