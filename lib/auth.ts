import * as SecureStore from 'expo-secure-store';

const ORGANISER_PASSWORD_KEY = 'organiser_password';
const ORGANISER_SAVED_AT_KEY = 'organiser_saved_at';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function saveOrganiserSession(password: string): Promise<void> {
  await SecureStore.setItemAsync(ORGANISER_PASSWORD_KEY, password);
  await SecureStore.setItemAsync(ORGANISER_SAVED_AT_KEY, Date.now().toString());
}

// Returns password if session is within 24 hours, null if expired or not set.
export async function getOrganiserPassword(): Promise<string | null> {
  const password = await SecureStore.getItemAsync(ORGANISER_PASSWORD_KEY);
  if (!password) return null;

  const savedAt = parseInt((await SecureStore.getItemAsync(ORGANISER_SAVED_AT_KEY)) ?? '0', 10);
  if (Date.now() - savedAt > SESSION_DURATION_MS) {
    await clearOrganiserSession();
    return null;
  }

  return password;
}

export async function clearOrganiserSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ORGANISER_PASSWORD_KEY);
  await SecureStore.deleteItemAsync(ORGANISER_SAVED_AT_KEY);
}
