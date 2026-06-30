import * as SecureStore from 'expo-secure-store';

const KEYS = {
  FIRST_NAME: 'user_first_name',
  LAST_NAME: 'user_last_name',
};

export async function saveUserName(firstName: string, lastName: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.FIRST_NAME, firstName.trim());
  await SecureStore.setItemAsync(KEYS.LAST_NAME, lastName.trim());
}

export async function getUserName(): Promise<{ firstName: string; lastName: string } | null> {
  const firstName = await SecureStore.getItemAsync(KEYS.FIRST_NAME);
  const lastName = await SecureStore.getItemAsync(KEYS.LAST_NAME);

  if (!firstName || !lastName) return null;
  return { firstName, lastName };
}

export async function clearUserName(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.FIRST_NAME);
  await SecureStore.deleteItemAsync(KEYS.LAST_NAME);
}
