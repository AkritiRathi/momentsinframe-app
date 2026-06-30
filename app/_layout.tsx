import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

// Placeholder auth state — replace with real auth logic later
function useAuth() {
  const [isAuthenticated] = useState(false);
  return { isAuthenticated };
}

export default function RootLayout() {
  const { isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(app)/albums');
    }
  }, [isAuthenticated, segments, mounted]);

  return <Slot />;
}
