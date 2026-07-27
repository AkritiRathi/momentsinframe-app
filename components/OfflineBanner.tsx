import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StatusBar, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Network from 'expo-network';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-40)).current;
  const insets = useSafeAreaInsets();
  const topOffset = Platform.OS === 'ios' ? insets.top : (StatusBar.currentHeight ?? 0);

  useEffect(() => {
    async function checkConnection() {
      const state = await Network.getNetworkStateAsync();
      setOffline(!state.isConnected || !state.isInternetReachable);
    }

    const unsub = Network.addNetworkStateListener((state) => {
      setOffline(!state.isConnected || !state.isInternetReachable);
    });

    checkConnection();

    return () => unsub.remove();
  }, []);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: offline ? 0 : -40,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [offline]);

  if (!offline) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: topOffset, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <Text style={styles.text}>⚠ No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc2626',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
