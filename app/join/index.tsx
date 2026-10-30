import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '../../constants/colors';

// Safety net for https://momentsinframe.com/join with NO event code.
// Android hands that address to this app (app.json intent filter), and
// app/join/[code].tsx only matches when a code is present — so without this
// screen the app opens and dead-ends on a blank splash.
// Since v2.0.6 the app claims only /join/ (app.json pathPrefix), so this now
// mostly serves older installed builds; kept as a harmless safety net that
// lands the user on the app's own join screen instead of nowhere.
export default function JoinNoCode() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(auth)/join-event');
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>
  );
}
