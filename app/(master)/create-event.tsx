import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Switch,
  KeyboardAvoidingView, Platform, ScrollView, Modal, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile, saveJoinedEvent } from '../../lib/storage';
import { createEvent } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';
import { API_BASE_URL } from '../../constants/config';

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

  // ⛔ INVITE-ONLY AND VIEW-ONLY ARE CHOSEN HERE AND NEVER AGAIN (2026-10-20).
  // The user's reason: an organiser who opens an event, lets guests join and
  // upload, then makes it private and removes everyone is treating them
  // unfairly. Freezing the choice removes that whole class — and with it the
  // bulk "remove all guests" purge. The settings route refuses both fields,
  // so this screen is the only way either is ever set.
  const [isClosed, setIsClosed] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);

  // The two-step password + confirm, same shape as Delete Event. It guards
  // CREATE, not the toggles: nothing is permanent until the event exists, so
  // a password to flip a switch you can still flip back would be ceremony
  // without protection.
  const [createStep, setCreateStep] = useState<null | 'password' | 'confirm'>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Only switching a toggle ON needs explaining. Switching it back off before
  // the event exists costs nothing, so it is silent.
  function handleInviteOnly(next: boolean) {
    if (!next) { setIsClosed(false); return; }
    showAlert(
      'Make this invite-only?',
      [
        '• Guests who are not on your list will not be able to join with the code',
        '• You will have to add each person’s mobile number yourself before they can join',
        '• You can add or remove people any time, before or during the event',
        '',
        'This cannot be changed after the event is created.',
      ].join('\n'),
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes, invite only', onPress: () => setIsClosed(true) }],
    );
  }

  function handleViewOnly(next: boolean) {
    if (!next) { setViewOnly(false); return; }
    showAlert(
      'Make this a view only event?',
      [
        '• Guests can only view and download photos uploaded to this event',
        '• Only you and your Admins can add photos',
        '• Guests cannot delete anything, including their own photos',
        '',
        'This cannot be changed after the event is created.',
      ].join('\n'),
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes, view only', onPress: () => setViewOnly(true) }],
    );
  }

  // Listed on BOTH final screens, and listed even when nothing was touched —
  // leaving a toggle alone is just as permanent as switching it on, and an
  // organiser who is never told that is the gap this closes.
  const settingsSummary = [
    isClosed
      ? '• Invite only — only people you add can join'
      : '• Open event — anyone with the event code can join',
    viewOnly
      ? '• View only — guests can only view and download photos'
      : '• Guests can upload photos, as well as view and download',
  ].join('\n');

  function handleCreate() {
    if (!name.trim()) {
      showAlert('Missing name', 'Please enter an event name.');
      return;
    }
    if (!expiryDate) {
      showAlert('Missing date', 'Please select an expiry date.');
      return;
    }
    setPassword('');
    setPasswordError(null);
    setCreateStep('password');
  }

  async function handlePasswordSubmit() {
    const profile = await getUserProfile();
    if (!profile) return;
    setVerifying(true);
    setPasswordError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/native/organiser/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: profile.mobile, password: password.trim() }),
      });
      const data = await res.json();
      if (!data.success) { setPasswordError('Incorrect password.'); return; }
      setCreateStep('confirm');
    } catch { setPasswordError('Could not verify. Try again.'); }
    finally { setVerifying(false); }
  }

  async function handleConfirmCreate() {
    setCreateStep(null);
    setLoading(true);
    try {
      const profile = await getUserProfile();
      const organiserPassword = await getOrganiserPassword();
      if (!profile || !organiserPassword) {
        showAlert('Session expired', 'Please log in again.');
        router.replace('/(auth)/home');
        return;
      }

      const result = await createEvent(profile.mobile, organiserPassword, name.trim(), toAPIFormat(expiryDate!), isClosed, viewOnly);
      if (result.error) {
        showAlert('Error', result.error);
        return;
      }

      if (result.event) {
        await saveJoinedEvent({
          slug: result.event.slug,
          name: result.event.name,
          expiresAt: result.event.expires_at,
          joinCode: result.event.join_code ?? '',
          createdAt: result.event.created_at ?? new Date().toISOString(),
          allowGuestDelete: result.event.allow_guest_delete ?? false,
          isOrganiser: true,
        });
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
            <TouchableOpacity style={styles.dateBtn} onPress={() => { Keyboard.dismiss(); setShowPicker(true); }}>
              <Text style={expiryDate ? styles.dateBtnText : styles.dateBtnPlaceholder}>
                {expiryDate ? formatDisplay(expiryDate) : 'Select date'}
              </Text>
              <Text style={styles.dateIcon}>📅</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Guests lose access after this date.</Text>

            {showPicker && Platform.OS === 'android' && (
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
            {Platform.OS === 'ios' && (
              <Modal transparent animationType="fade" visible={showPicker} onRequestClose={() => setShowPicker(false)}>
                <View style={styles.iosPickerOverlay}>
                  <View style={styles.iosPickerCard}>
                    <Text style={styles.iosPickerTitle}>Select expiry date</Text>
                    <View style={{ alignItems: 'center' }}>
                      <DateTimePicker
                        value={expiryDate ?? tomorrow}
                        mode="date"
                        display="inline"
                        minimumDate={today}
                        onChange={(_, selected) => { if (selected) setExpiryDate(selected); }}
                      />
                    </View>
                    <View style={styles.iosPickerBtns}>
                      <TouchableOpacity style={styles.iosPickerCancelBtn} onPress={() => setShowPicker(false)}>
                        <Text style={styles.iosPickerCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.iosPickerConfirmBtn} onPress={() => setShowPicker(false)}>
                        <Text style={styles.iosPickerConfirmText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>
            )}

            <Text style={styles.label}>SETTINGS</Text>
            <Text style={styles.hint}>These cannot be changed after the event is created.</Text>

            <View style={styles.toggleCard}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Invite only event</Text>
                <Text style={styles.toggleDesc}>
                  {isClosed ? 'Only guests on the allowed list can join' : 'Anyone with the event code can join'}
                </Text>
              </View>
              <Switch
                value={isClosed}
                onValueChange={handleInviteOnly}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
            </View>

            <View style={styles.toggleCard}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>View only event</Text>
                <Text style={styles.toggleDesc}>
                  {viewOnly ? 'Guests can only view and download photos' : 'Guests can upload, view and download photos'}
                </Text>
              </View>
              <Switch
                value={viewOnly}
                onValueChange={handleViewOnly}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
            </View>

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
      {/* ⛔ Step 1 — the password, in the same two-step shape as Delete Event
          and for the same reason: this is the moment the choice becomes
          permanent. The toggles themselves are not password-gated, because
          nothing is locked until the event exists. */}
      <Modal visible={createStep === 'password'} transparent animationType="fade" onRequestClose={() => setCreateStep(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Verify your password</Text>
            <Text style={styles.modalWarning}>
              You are about to create <Text style={styles.modalStrong}>{name.trim()}</Text> with these settings:
            </Text>
            <Text style={styles.modalBullets}>{settingsSummary}</Text>
            <Text style={styles.modalWarning}>These cannot be changed later.</Text>
            <TextInput
              style={styles.modalInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor="#444"
              secureTextEntry
              autoCapitalize="none"
            />
            {passwordError && <Text style={styles.modalError}>{passwordError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateStep(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (!password.trim() || verifying) && { opacity: 0.5 }]}
                disabled={!password.trim() || verifying}
                onPress={handlePasswordSubmit}
              >
                <Text style={styles.modalConfirmText}>{verifying ? 'Verifying...' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Step 2 — the choices listed again, in full, so no event is ever
          created without them having been put in front of the organiser. */}
      <Modal visible={createStep === 'confirm'} transparent animationType="fade" onRequestClose={() => setCreateStep(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create “{name.trim()}”?</Text>
            <Text style={styles.modalBullets}>{settingsSummary}</Text>
            <Text style={styles.modalWarning}>
              Neither of these can be changed after the event is created.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateStep(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleConfirmCreate}>
                <Text style={styles.modalConfirmText}>Create event</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, borderWidth: 0.5, borderColor: '#333' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  modalWarning: { fontSize: 13, color: '#888780', lineHeight: 20, marginBottom: 12 },
  modalStrong: { color: Colors.white, fontWeight: '700' },
  modalBullets: { fontSize: 13, color: Colors.white, lineHeight: 22, marginBottom: 12 },
  modalInput: { backgroundColor: '#111', borderWidth: 0.5, borderColor: '#333', borderRadius: 10, padding: 14, fontSize: 15, color: Colors.white, marginBottom: 10 },
  modalError: { fontSize: 13, color: '#E53935', marginBottom: 10 },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, borderWidth: 1.5, borderColor: '#333', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '700', color: '#888780' },
  modalConfirm: { flex: 1, backgroundColor: Colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalConfirmText: { fontSize: 15, fontWeight: '800', color: Colors.background },
  iosPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  iosPickerCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 8 },
  iosPickerTitle: { color: '#111', fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  iosPickerBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12 },
  iosPickerCancelBtn: { padding: 12, flex: 1, alignItems: 'center' },
  iosPickerCancelText: { color: '#555', fontSize: 15 },
  iosPickerConfirmBtn: { padding: 12, flex: 1, alignItems: 'center', backgroundColor: Colors.accent, borderRadius: 10 },
  iosPickerConfirmText: { color: Colors.background, fontSize: 15, fontWeight: '700' },
});
