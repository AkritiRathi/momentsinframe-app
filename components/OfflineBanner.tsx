import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import * as Network from 'expo-network';
import { API_BASE_URL } from '../constants/config';

const SLOW_THRESHOLD_MS = 2500;
const PING_INTERVAL_MS = 60_000;

type BannerState = 'hidden' | 'offline' | 'slow';

export default function OfflineBanner() {
  const [banner, setBanner] = useState<BannerState>('hidden');
  const slideAnim = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    let pingTimer: ReturnType<typeof setTimeout> | null = null;

    async function checkConnection() {
      const state = await Network.getNetworkStateAsync();
      if (!state.isConnected || !state.isInternetReachable) {
        setBanner('offline');
        return;
      }
      try {
        const start = Date.now();
        const res = await fetch(`${API_BASE_URL}/api/ping`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(SLOW_THRESHOLD_MS),
        });
        const elapsed = Date.now() - start;
        if (!res.ok || elapsed >= SLOW_THRESHOLD_MS) {
          setBanner('slow');
        } else {
          setBanner('hidden');
        }
      } catch {
        setBanner('slow');
      }
    }

    const unsub = Network.addNetworkStateListener(async (state) => {
      if (!state.isConnected || !state.isInternetReachable) {
        setBanner('offline');
      } else {
        await checkConnection();
      }
    });

    checkConnection();
    pingTimer = setInterval(checkConnection, PING_INTERVAL_MS);

    return () => {
      unsub.remove();
      if (pingTimer) clearInterval(pingTimer);
    };
  }, []);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: banner === 'hidden' ? -40 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [banner]);

  if (banner === 'hidden') return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        banner === 'offline' ? styles.offline : styles.slow,
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      <Text style={styles.text}>
        {banner === 'offline' ? '⚠ No internet connection' : '⚠ Slow connection'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offline: { backgroundColor: '#dc2626' },
  slow: { backgroundColor: '#d97706' },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
