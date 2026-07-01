import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { getUserProfile } from '../lib/storage';
import { isMasterAdmin } from '../lib/auth';
import * as Updates from 'expo-updates';

// Keep native splash visible until we finish the update check
SplashScreen.preventAutoHideAsync();

type UpdateStage = 'checking' | 'available' | 'ready';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [updateStage, setUpdateStage] = useState<UpdateStage>('checking');
  const [updating, setUpdating] = useState(false);

  // On launch, check for update. Block the app until we know.
  useEffect(() => {
    (async () => {
      if (__DEV__) {
        setUpdateStage('ready');
        SplashScreen.hideAsync();
        return;
      }
      try {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          setUpdateStage('available');
        } else {
          setUpdateStage('ready');
        }
      } catch {
        // If check fails (e.g. no network), let the app proceed
        setUpdateStage('ready');
      }
      SplashScreen.hideAsync();
    })();
  }, []);

  async function handleUpdate() {
    setUpdating(true);
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      setUpdating(false);
      // If download fails, let the app proceed
      setUpdateStage('ready');
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || updateStage !== 'ready') return;

    (async () => {
      const profile = await getUserProfile();
      setHasProfile(!!profile);
    })();
  }, [mounted, updateStage]);

  // Re-check auth state on every navigation change
  useEffect(() => {
    if (!mounted || updateStage !== 'ready') return;

    (async () => {
      const profile = await getUserProfile();
      const profileExists = !!profile;
      setHasProfile(profileExists);

      const currentScreen = segments[1] as string | undefined;
      const inMaster = segments[0] === '(master)';
      const inAuth = segments[0] === '(auth)';
      const inEvent = segments[0] === 'event';
      const master = await isMasterAdmin();

      if (!profileExists) {
        if (currentScreen !== 'name-entry') {
          router.replace('/(auth)/name-entry');
        }
        return;
      }

      // Event screen is accessible to all authenticated users (guests, event admins, master admins)
      if (inEvent) return;

      if (master && !inMaster) {
        router.replace('/(master)/dashboard');
        return;
      }

      if (!master && inMaster) {
        router.replace('/(auth)/home');
        return;
      }

      if (!master && !inAuth) {
        router.replace('/(auth)/home');
      }
    })();
  }, [mounted, hasProfile, segments, updateStage]);

  if (updateStage === 'checking' || updateStage === 'available') {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={styles.splash}>
          <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.appName}>MomentsInFrame</Text>

          {updateStage === 'checking' && (
            <ActivityIndicator color="#fff" style={styles.spinner} />
          )}

          {updateStage === 'available' && (
            <View style={styles.updateBox}>
              <Text style={styles.updateTitle}>Update Available</Text>
              <Text style={styles.updateMsg}>A new version of MomentsInFrame is ready.</Text>
              <TouchableOpacity
                style={[styles.updateBtn, updating && styles.updateBtnDisabled]}
                onPress={handleUpdate}
                disabled={updating}
              >
                <Text style={styles.updateBtnText}>
                  {updating ? 'Updating…' : 'Update Now'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 16,
  },
  appName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
    marginBottom: 32,
  },
  spinner: {
    marginTop: 8,
  },
  updateBox: {
    alignItems: 'center',
    gap: 12,
  },
  updateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  updateMsg: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
  },
  updateBtn: {
    marginTop: 8,
    backgroundColor: '#4f8ef7',
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 10,
  },
  updateBtnDisabled: {
    opacity: 0.6,
  },
  updateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
