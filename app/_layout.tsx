import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getUserProfile } from '../lib/storage';
import { isMasterAdmin } from '../lib/auth';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    (async () => {
      const profile = await getUserProfile();
      setHasProfile(!!profile);
    })();
  }, [mounted]);

  // Re-check auth state on every navigation change
  useEffect(() => {
    if (!mounted || hasProfile === null) return;

    (async () => {
      const currentScreen = segments[1] as string | undefined;
      const inMaster = segments[0] === '(master)';
      const inAuth = segments[0] === '(auth)';
      const master = await isMasterAdmin();

      if (!hasProfile) {
        if (currentScreen !== 'name-entry') {
          router.replace('/(auth)/name-entry');
        }
        return;
      }

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
  }, [mounted, hasProfile, segments]);

  return (
    <SafeAreaProvider>
      <Slot />
    </SafeAreaProvider>
  );
}
