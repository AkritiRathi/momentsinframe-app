import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { joinEvent, joinEventUser, checkAdminStatus } from '../../lib/api';
import { saveLastEventCode, getLastEventCode, getDeviceId, saveEventUserId, getUserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function JoinEventScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getLastEventCode().then(saved => { if (saved) setCode(saved); });
  }, []);

  async function handleCodeChange(value: string) {
    const cleaned = value.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(cleaned);
  }

  async function attemptJoin(joinCode: string) {
    if (joinCode.length !== 6) {
      showAlert('Invalid code', 'Please enter a 6-digit event code.');
      return;
    }
    setLoading(true);
    try {
      const profile = await getUserProfile();
      const result = await joinEvent(joinCode, profile?.mobile);
      if (result.error) {
        showAlert('Could not join', result.error, [
          { text: 'Try again', onPress: () => setCode('') },
        ]);
      } else {
        await saveLastEventCode(joinCode);
        // Check if this user is organiser or co-admin for this event
        let isAdmin = false;
        if (profile?.mobile) {
          const adminCheck = await checkAdminStatus(result.event.slug, profile.mobile);
          isAdmin = adminCheck.isAdmin ?? false;
        }
        if (profile) {
          getDeviceId().then(async deviceId => {
            const userResult = await joinEventUser(result.event.slug, `${profile.firstName} ${profile.lastName}`, profile.mobile, deviceId);
            if (userResult.eventUserId) await saveEventUserId(userResult.eventUserId);
          }).catch(() => {});
        }
        router.replace({
          pathname: '/event',
          params: {
            slug: result.event.slug,
            name: result.event.name,
            expiresAt: result.event.expires_at,
            createdAt: result.event.created_at ?? new Date().toISOString(),
            isAdmin: isAdmin ? 'true' : 'false',
            adminPhone: '',
            allowGuestDelete: result.event.allow_guest_delete ? 'true' : 'false',
          },
        });
      }
    } catch {
      showAlert('Error', 'Something went wrong. Please check your connection and try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.title}>Join An Event</Text>
        <Text style={styles.subtitle}>Enter the 6-digit event code shared by the organiser.</Text>

        <Text style={styles.label}>EVENT CODE</Text>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={handleCodeChange}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="– – – – – –"
          placeholderTextColor="#333"
          textAlign="center"
          autoFocus
        />

        <TouchableOpacity
          style={[styles.joinBtn, (code.length !== 6 || loading) && { opacity: 0.4 }]}
          onPress={() => attemptJoin(code)}
          disabled={code.length !== 6 || loading}
        >
          {loading
            ? <ActivityIndicator color={Colors.background} />
            : <Text style={styles.joinBtnText}>Join Event</Text>
          }
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.qrButton} onPress={() => showAlert('Coming soon', 'QR scanner will be added shortly.')}>
          <Text style={styles.qrIcon}>📷</Text>
          <Text style={styles.qrText}>Scan QR code instead</Text>
        </TouchableOpacity>
      </View>
      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  back: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { flex: 1, padding: 24, paddingTop: 16 },
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 32 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 12 },
  codeInput: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 16,
    padding: 20,
    fontSize: 32,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 12,
    marginBottom: 20,
  },
  joinBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  joinBtnText: { ...Typography.buttonText, color: Colors.background },
  divider: { height: 0.5, backgroundColor: '#222', marginVertical: 24 },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    borderRadius: 14,
    padding: 16,
  },
  qrIcon: { fontSize: 20 },
  qrText: { fontSize: 14, color: Colors.white, fontWeight: '600' },
});
