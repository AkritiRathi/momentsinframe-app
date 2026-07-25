import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';
import * as Linking from 'expo-linking';

type PermissionType = 'photos' | 'contacts' | 'notifications';

function flagKey(type: PermissionType, phone: string): string {
  return `priming_${type}_shown_${phone}`;
}

export async function hasPrimingBeenShown(type: PermissionType, phone: string): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(flagKey(type, phone));
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markPrimingShown(type: PermissionType, phone: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(flagKey(type, phone), 'true');
  } catch {}
}

export function showPermissionDeniedAlert(permissionLabel: string): void {
  Alert.alert(
    'Permission Required',
    `${permissionLabel} access was denied. To use this feature, go to Settings and enable ${permissionLabel} access for Moments in Frame.`,
    [
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}

export function shouldShowDeniedAlert(granted: boolean, canAskAgain: boolean): boolean {
  if (granted) return false;
  return Platform.OS === 'ios' || !canAskAgain;
}
