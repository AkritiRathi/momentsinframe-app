import * as SecureStore from 'expo-secure-store';

const MASTER_SESSION_KEY = 'master_admin_session';
const MASTER_PASSWORD_KEY = 'master_admin_password';

export async function saveMasterSession(password: string): Promise<void> {
  await SecureStore.setItemAsync(MASTER_SESSION_KEY, 'true');
  await SecureStore.setItemAsync(MASTER_PASSWORD_KEY, password);
}

export async function isMasterAdmin(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(MASTER_SESSION_KEY);
  return val === 'true';
}

export async function getMasterPassword(): Promise<string | null> {
  return SecureStore.getItemAsync(MASTER_PASSWORD_KEY);
}

export async function clearMasterSession(): Promise<void> {
  await SecureStore.deleteItemAsync(MASTER_SESSION_KEY);
  await SecureStore.deleteItemAsync(MASTER_PASSWORD_KEY);
}
