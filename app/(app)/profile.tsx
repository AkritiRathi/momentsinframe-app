import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function ProfileScreen() {
  const { showAlert, alertOverlay } = useAlert();
  const [checking, setChecking] = useState(false);

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
});
