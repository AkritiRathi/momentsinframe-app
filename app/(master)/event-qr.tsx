import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useRef, useState } from 'react';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Colors } from '../../constants/colors';

export default function EventQRScreen() {
  const router = useRouter();
  const { name, join_code } = useLocalSearchParams<{ name: string; join_code: string }>();
  const viewShotRef = useRef<ViewShot>(null);
  const qrPdfRef = useRef<View>(null);
  const [sharingImage, setSharingImage] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);

  async function handleShareImage() {
    try {
      setSharingImage(true);
      const uri = await viewShotRef.current!.capture!();
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: `${name} QR Code` });
    } catch {} finally {
      setSharingImage(false);
    }
  }

  async function handleSharePdf() {
    try {
      setSharingPdf(true);
      const qrBase64 = await captureRef(qrPdfRef, { format: 'png', quality: 1.0, result: 'base64' });
      const html = `
        <html><body style="margin:0;padding:60px 40px;background:#fff;font-family:sans-serif;text-align:center;">
          <h2 style="font-size:26px;font-weight:800;margin-bottom:8px;">${name}</h2>
          <p style="font-size:32px;font-weight:800;letter-spacing:10px;margin:0 0 40px;">${join_code}</p>
          <img src="data:image/png;base64,${qrBase64}" style="width:320px;height:320px;" />
          <p style="margin-top:28px;font-size:13px;color:#888;">Scan the QR code or enter the code above to join the event on MomentsInFrame.</p>
        </body></html>`;
      const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: `${name} QR Code` });
    } catch {} finally {
      setSharingPdf(false);
    }
  }


  return (
    <SafeAreaView style={styles.container}>
      <View ref={qrPdfRef} collapsable={false} style={{ position: 'absolute', top: -2000, left: 0 }}>
        <View style={{ backgroundColor: '#FFFFFF', padding: 8 }}>
          <QRCode value={join_code} size={400} color="#000000" backgroundColor="#FFFFFF" />
        </View>
      </View>

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

        <TouchableOpacity style={[styles.shareBtn, styles.shareBtnOutline]} onPress={handleSharePdf} disabled={sharingPdf}>
          {sharingPdf
            ? <ActivityIndicator color={Colors.accent} />
            : <Text style={[styles.shareBtnText, styles.shareBtnOutlineText]}>Share as PDF →</Text>
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
  shareBtnOutline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: Colors.accent },
  shareBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
  shareBtnOutlineText: { color: Colors.accent },
});
