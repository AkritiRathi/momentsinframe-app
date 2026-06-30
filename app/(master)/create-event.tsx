import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { getMasterPassword } from '@/lib/auth';
import { createEvent } from '@/lib/api';
import { Colors } from '@/constants/colors';

export default function CreateEventScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter an event name.');
      return;
    }
    if (!expiresAt.trim()) {
      Alert.alert('Missing date', 'Please enter an expiry date.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt.trim())) {
      Alert.alert('Invalid date', 'Please enter the date in YYYY-MM-DD format (e.g. 2026-07-15).');
      return;
    }

    setLoading(true);
    try {
      const masterPassword = await getMasterPassword();
      if (!masterPassword) {
        Alert.alert('Session expired', 'Please log in again.');
        router.replace('/(auth)/home');
        return;
      }

      const result = await createEvent(masterPassword, name.trim(), expiresAt.trim());
      if (result.error) {
        Alert.alert('Error', result.error);
        return;
      }

      router.replace('/(master)/dashboard');
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          <View style={styles.body}>
            <Text style={styles.title}>New event</Text>
            <Text style={styles.subtitle}>Fill in the details below to create a new event.</Text>

            <Text style={styles.label}>EVENT NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Rathi Family Wedding"
              placeholderTextColor="#444"
            />

            <Text style={styles.label}>EXPIRY DATE</Text>
            <TextInput
              style={styles.input}
              value={expiresAt}
              onChangeText={setExpiresAt}
              placeholder="YYYY-MM-DD (e.g. 2026-07-15)"
              placeholderTextColor="#444"
              keyboardType="numbers-and-punctuation"
            />
            <Text style={styles.hint}>Guests lose access after this date.</Text>

            <View style={styles.noteCard}>
              <Text style={styles.noteIcon}>ℹ️</Text>
              <Text style={styles.noteText}>Event code and admin password will be auto-generated after creation.</Text>
            </View>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={loading}>
              <Text style={styles.createBtnText}>{loading ? 'Creating...' : 'Create event →'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { padding: 24, paddingTop: 16 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 28 },
  label: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 8 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
    marginBottom: 16,
  },
  hint: { fontSize: 12, color: '#444', marginBottom: 20 },
  noteCard: {
    backgroundColor: Colors.card,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 24,
  },
  noteIcon: { fontSize: 16 },
  noteText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  divider: { height: 0.5, backgroundColor: '#222', marginBottom: 20 },
  createBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  createBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
