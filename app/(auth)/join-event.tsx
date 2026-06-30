import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { joinEvent } from '../../lib/api';
import { Colors } from '../../constants/colors';

export default function JoinEventScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCodeChange(value: string) {
    const cleaned = value.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) {
      await attemptJoin(cleaned);
    }
  }

  async function attemptJoin(joinCode: string) {
    setLoading(true);
    try {
      const result = await joinEvent(joinCode);
      if (result.error) {
        Alert.alert('Could not join', result.error, [
          { text: 'Try again', onPress: () => setCode('') },
        ]);
      } else {
        router.replace({
          pathname: '/event',
          params: {
            slug: result.event.slug,
            name: result.event.name,
            expiresAt: result.event.expires_at,
            createdAt: result.event.created_at ?? new Date().toISOString(),
            isAdmin: 'false',
            adminPassword: '',
          },
        });
      }
    } catch {
      Alert.alert('Error', 'Something went wrong. Please check your connection and try again.');
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

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Colors.accent} />
            <Text style={styles.loadingText}>Looking up event...</Text>
          </View>
        )}

        <View style={styles.divider} />

        <TouchableOpacity style={styles.qrButton} onPress={() => Alert.alert('Coming soon', 'QR scanner will be added shortly.')}>
          <Text style={styles.qrIcon}>📷</Text>
          <Text style={styles.qrText}>Scan QR code instead</Text>
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
  title: { fontSize: 26, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 32 },
  label: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 12 },
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  loadingText: { fontSize: 13, color: Colors.textMuted },
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
