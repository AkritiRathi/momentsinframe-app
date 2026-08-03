import { useState } from 'react';
import React from 'react';
import * as Contacts from 'expo-contacts';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-camera';
import * as Linking from 'expo-linking';
import PermissionPrimingModal from '../components/PermissionPrimingModal';
import { hasPrimingBeenShown, markPrimingShown } from './priming';
import { useAlert } from './useAlert';

export type AppPermissionType = 'contacts' | 'gallery' | 'notifications' | 'camera';

type PermissionStatus = { granted: boolean; canAskAgain: boolean };

type PermissionConfig = {
  icon: string;
  title: string;
  description: string;
  label: string;
  primingKey: 'photos' | 'contacts' | 'notifications' | 'camera';
  markShownOnDismiss: boolean;
  getStatus: () => Promise<PermissionStatus>;
  requestPermission: () => Promise<PermissionStatus>;
};

const CONFIGS: Record<AppPermissionType, PermissionConfig> = {
  contacts: {
    icon: '👥',
    title: 'Access Your Contacts',
    description: 'To find your guests by name, Moments in Frame needs access to your contacts.',
    label: 'Contacts',
    primingKey: 'contacts',
    markShownOnDismiss: false,
    getStatus: async () => {
      const { status, canAskAgain } = await Contacts.getPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? true };
    },
    requestPermission: async () => {
      const { status, canAskAgain } = await Contacts.requestPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? false };
    },
  },
  gallery: {
    icon: '🖼️',
    title: 'Access Your Gallery',
    description: 'To upload and download photos, Moments in Frame needs access to your photo library.',
    label: 'Photos',
    primingKey: 'photos',
    markShownOnDismiss: false,
    getStatus: async () => {
      const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
      return { granted: status === 'granted' || (status as string) === 'limited', canAskAgain: canAskAgain ?? true };
    },
    requestPermission: async () => {
      const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();
      return { granted: status === 'granted' || (status as string) === 'limited', canAskAgain: canAskAgain ?? false };
    },
  },
  notifications: {
    icon: '🔔',
    title: 'Enable Notifications',
    description: 'To get upload and event updates, Moments in Frame needs notification access.',
    label: 'Notifications',
    primingKey: 'notifications',
    markShownOnDismiss: true,
    getStatus: async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? true };
    },
    requestPermission: async () => {
      const { status, canAskAgain } = await Notifications.requestPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? false };
    },
  },
  camera: {
    icon: '📷',
    title: 'Access Your Camera',
    description: 'To scan QR codes, Moments in Frame needs access to your camera.',
    label: 'Camera',
    primingKey: 'camera',
    markShownOnDismiss: false,
    getStatus: async () => {
      const { status, canAskAgain } = await getCameraPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? true };
    },
    requestPermission: async () => {
      const { status, canAskAgain } = await requestCameraPermissionsAsync();
      return { granted: status === 'granted', canAskAgain: canAskAgain ?? false };
    },
  },
};

type PrimingState = { type: AppPermissionType; userKey: string; onContinue: () => void } | null;

export function useAppPermission() {
  const [primingState, setPrimingState] = useState<PrimingState>(null);
  const { showAlert, alertOverlay: deniedAlertOverlay } = useAlert();

  function showDenied(label: string) {
    showAlert(
      'Permission Required',
      `${label} access was denied. To use this feature, go to Settings and enable ${label} access for Moments in Frame.`,
      [
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function requestAppPermission(
    type: AppPermissionType,
    onGranted: () => void,
    phone?: string | null
  ): Promise<void> {
    const config = CONFIGS[type];
    const status = await config.getStatus();

    if (status.granted) {
      onGranted();
      return;
    }

    if (!status.canAskAgain) {
      showDenied(config.label);
      return;
    }

    const userKey = phone ?? 'global';
    const primingShown = await hasPrimingBeenShown(config.primingKey, userKey);

    if (!primingShown) {
      setPrimingState({
        type,
        userKey,
        onContinue: async () => {
          setPrimingState(null);
          await markPrimingShown(config.primingKey, userKey);
          const result = await config.requestPermission();
          if (result.granted) {
            onGranted();
          } else if (!result.canAskAgain) {
            showDenied(config.label);
          }
        },
      });
      return;
    }

    const result = await config.requestPermission();
    if (result.granted) {
      onGranted();
    } else {
      showDenied(config.label);
    }
  }

  const primingModalEl = primingState
    ? React.createElement(PermissionPrimingModal, {
        visible: true,
        icon: CONFIGS[primingState.type].icon,
        title: CONFIGS[primingState.type].title,
        description: CONFIGS[primingState.type].description,
        onContinue: primingState.onContinue,
        onDismiss: async () => {
          if (CONFIGS[primingState.type].markShownOnDismiss) {
            await markPrimingShown(CONFIGS[primingState.type].primingKey, primingState.userKey);
          }
          setPrimingState(null);
        },
      })
    : null;

  const primingOverlay = React.createElement(React.Fragment, null, primingModalEl, deniedAlertOverlay);

  return { requestAppPermission, primingOverlay };
}
