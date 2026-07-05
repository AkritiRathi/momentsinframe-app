import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getLastEvent } from '../lib/storage';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const saved = await getLastEvent();
      if (saved) {
        router.replace({ pathname: '/event', params: saved });
      } else {
        router.replace('/(auth)/home');
      }
    })();
  }, []);

  return null;
}
