import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { createEvent } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

function formatDisplay(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toAPIFormat(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function CreateEventScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [name, setName] = useState('');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const tomorrow = new Date();
  const today = new Date();

  async function handleCreate() {
    if (!name.trim()) {
      showAlert('Missing name', 'Please enter an event name.');
      return;
    }
    if (!expiryDate) {
      showAlert('Missing date', 'Please select an expiry date.');
      return;
    }

    setLoading(true);
    try {
      const profile = await getUserProfile();
      const organiserPassword = await getOrganiserPassword();
      if (!profile || !organiserPassword) {
        showAlert('Session expired', 'Please log in again.');
        router.replace('/(auth)/home');
        return;
      }

      const result = await createEvent(profile.mobile, organiserPassword, name.trim(), toAPIFormat(expiryDate), false);
      if (result.error) {
        showAlert('Error', result.error);
        return;
      }

      router.replace('/(master)/dashboard');
    } catch {
      showAlert('Error', 'Something went wrong. Please try again.');
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
              onChangeText={(v) => setName(v.slice(0, 50))}
              placeholder="e.g. Rathi Family Wedding"
              placeholderTextColor="#444"
              maxLength={50}
            />
            <Text style={styles.charCount}>{name.length}/50</Text>

            <Text style={styles.label}>EXPIRY DATE</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
              <Text style={expiryDate ? styles.dateBtnText : styles.dateBtnPlaceholder}>
                {expiryDate ? formatDisplay(expiryDate) : 'Select date'}
              </Text>
              <Text style={styles.dateIcon}>📅</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Guests lose access after this date.</Text>

            {showPicker && (
              <DateTimePicker
                value={expiryDate ?? tomorrow}
                mode="date"
                display="default"
                minimumDate={today}
                onChange={(_, selected) => {
                  setShowPicker(false);
                  if (selected) setExpiryDate(selected);
                }}
              />
            )}

            <View style={styles.noteCard}>
              <Text style={styles.noteIcon}>ℹ️</Text>
              <Text style={styles.noteText}>An event code will be auto-generated. Share it with guests so they can join.</Text>
            </View>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={loading}>
              <Text style={styles.createBtnText}>{loading ? 'Creating...' : 'Create event →'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {alertOverlay}
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
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 28 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
    marginBottom: 4,
  },
  charCount: { fontSize: 11, color: '#444', textAlign: 'right', marginBottom: 20 },
  dateBtn: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateBtnText: { fontSize: 15, color: Colors.white, fontWeight: '600' },
  dateBtnPlaceholder: { fontSize: 15, color: '#444' },
  dateIcon: { fontSize: 18 },
  hint: { ...Typography.caption, color: '#444', marginBottom: 20 },
  toggleCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.cardBorder,
    borderRadius: 12, padding: 14, marginBottom: 20,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: Colors.white },
  toggleDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
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
  noteText: { ...Typography.caption, flex: 1, color: Colors.textMuted },
  divider: { height: 0.5, backgroundColor: '#222', marginBottom: 20 },
  createBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  createBtnText: { ...Typography.buttonText, color: Colors.background },
});
