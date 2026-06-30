import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { getUserProfile } from '@/lib/storage';
import { isMasterAdmin } from '@/lib/auth';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    (async () => {
      const profile = await getUserProfile();
      const master = await isMasterAdmin();
      setHasProfile(!!profile);
      setIsMaster(master);
      setReady(true);
    })();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !ready) return;

    const inAuth = segments[0] === '(auth)';
    const inMaster = segments[0] === '(master)';

    if (!hasProfile) {
      router.replace('/(auth)/name-entry');
    } else if (isMaster && !inMaster) {
      router.replace('/(master)/dashboard');
    } else if (!isMaster && inMaster) {
      router.replace('/(auth)/home');
    } else if (!inAuth && !inMaster) {
      router.replace('/(auth)/home');
    }
  }, [mounted, ready, hasProfile, isMaster, segments]);

  return <Slot />;
}
