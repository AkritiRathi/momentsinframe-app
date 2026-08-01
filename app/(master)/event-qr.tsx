import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useRef, useState } from 'react';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Colors } from '../../constants/colors';

export default function EventQRScreen() {
  const router = useRouter();
  const { name, join_code } = useLocalSearchParams<{ name: string; join_code: string }>();
  const viewShotRef = useRef<ViewShot>(null);
  const [sharingImage, setSharingImage] = useState(false);

  async function handleShareImage() {
    try {
      setSharingImage(true);
      const uri = await viewShotRef.current!.capture!();
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: `${name} QR Code` });
    } catch {} finally {
      setSharingImage(false);
    }
  }


  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.title}>Event QR Code</Text>
        <Text style={styles.subtitle}>Share this QR so guests can join instantly.</Text>

        <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 1.0 }}>
          <View style={styles.qrCard}>
            <Text style={styles.eventName}>{name}</Text>
            <Text style={styles.eventCode}>{join_code}</Text>
            <View style={styles.qrWrap}>
              <QRCode
                value={join_code}
                size={200}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            </View>
          </View>
        </ViewShot>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShareImage} disabled={sharingImage}>
          {sharingImage
            ? <ActivityIndicator color={Colors.background} />
            : <Text style={styles.shareBtnText}>Share as Image →</Text>
          }
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { flex: 1, padding: 24, paddingTop: 16 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textMuted, marginBottom: 32 },
  qrCard: {
    backgroundColor: Colors.white, borderRadius: 20, padding: 24,
    alignItems: 'center', marginBottom: 24,
  },
  eventName: { fontSize: 16, fontWeight: '800', color: '#0F0F0F', marginBottom: 4, textAlign: 'center' },
  eventCode: { fontSize: 22, fontWeight: '800', color: '#0F0F0F', letterSpacing: 4, marginBottom: 24 },
  qrWrap: { padding: 8, backgroundColor: '#FFFFFF', borderRadius: 12 },
  shareBtn: { backgroundColor: Colors.accent, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
  shareBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
