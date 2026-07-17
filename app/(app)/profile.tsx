import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';
import { getUserProfile, clearUserProfile } from '../../lib/storage';
import { deleteAccount } from '../../lib/api';

export default function ProfileScreen() {
  const { showAlert, alertOverlay } = useAlert();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function checkForUpdates() {
    if (__DEV__) {
      showAlert('Updates disabled', 'Update checks only work in the built app, not in Expo Go.');
      return;
    }
    setChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        showAlert(
          'Update available',
          'A new version is ready. The app will restart to apply it.',
          [
            {
              text: 'Update now',
              onPress: async () => {
                await Updates.fetchUpdateAsync();
                await Updates.reloadAsync();
              },
            },
            { text: 'Later', style: 'cancel' },
          ]
        );
      } else {
        showAlert('Up to date', 'You already have the latest version.');
      }
    } catch {
      showAlert('Error', 'Could not check for updates. Make sure you are connected to the internet.');
    } finally {
      setChecking(false);
    }
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and remove you from all events. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const profile = await getUserProfile();
              if (!profile) {
                showAlert('Error', 'Could not find your account details.');
                return;
              }
              const result = await deleteAccount(profile.mobile);
              if (result.error) {
                showAlert('Error', result.error);
                return;
              }
              await clearUserProfile();
              await AsyncStorage.clear();
              router.replace('/(auth)/name-entry');
            } catch {
              showAlert('Error', 'Something went wrong. Please try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      {alertOverlay}
      <Text style={styles.title}>MomentsInFrame</Text>
      <Text style={styles.version}>Version {Updates.runtimeVersion ?? '1.0.0'}</Text>

      <TouchableOpacity style={styles.btn} onPress={checkForUpdates} disabled={checking}>
        {checking
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Check for Updates</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} disabled={deleting}>
        {deleting
          ? <ActivityIndicator color="#FF4444" />
          : <Text style={styles.deleteBtnText}>Delete Account</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    gap: 12,
  },
  title: { ...Typography.eventName, color: Colors.text },
  version: { ...Typography.body, color: Colors.textMuted, marginBottom: 16 },
  btn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    minWidth: 200,
    alignItems: 'center',
  },
  btnText: { ...Typography.buttonText, color: '#fff' },
  deleteBtn: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    minWidth: 200,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF4444',
  },
  deleteBtnText: { ...Typography.buttonText, color: '#FF4444' },
});
