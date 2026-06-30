import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Clipboard } from 'react-native';
import { getMasterPassword } from '../../lib/auth';
import { extendEvent, changeEventAdminPassword } from '../../lib/api';
import { Colors } from '../../constants/colors';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function EventDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string; name: string; slug: string; join_code: string;
    event_admin_password: string; created_at: string; expires_at: string; photo_count: string;
  }>();

  const [currentAdminPassword, setCurrentAdminPassword] = useState(params.event_admin_password);
  const [promptModal, setPromptModal] = useState<{ title: string; onSubmit: (v: string) => void } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [resetModal, setResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function showPrompt(title: string, onSubmit: (v: string) => void) {
    setPromptValue('');
    setPromptModal({ title, onSubmit });
  }

  function copyCode() {
    Clipboard.setString(params.join_code);
    Alert.alert('Copied', `Event code ${params.join_code} copied.`);
  }

  function copyAdminDetails() {
    const text = `Event: ${params.name}\nEvent Code: ${params.join_code}\nAdmin Password: ${currentAdminPassword}`;
    Clipboard.setString(text);
    Alert.alert('Copied', 'Admin details copied to clipboard.');
  }

  async function handleExtend() {
    showPrompt('New expiry date (YYYY-MM-DD)', async (newDate) => {
      if (!newDate.trim()) return;
      const pw = await getMasterPassword();
      if (!pw) return;
      const result = await extendEvent(params.slug, pw, newDate.trim());
      if (result.error) {
        Alert.alert('Error', result.error);
      } else {
        Alert.alert('Done', 'Expiry date updated.');
        router.back();
      }
    });
  }

  async function submitResetPassword() {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing fields', 'Please fill in both fields.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    const pw = await getMasterPassword();
    if (!pw) return;
    const result = await changeEventAdminPassword(params.slug, pw, newPassword.trim());
    if (result.error) {
      Alert.alert('Error', result.error);
    } else {
      setCurrentAdminPassword(newPassword.trim());
      setResetModal(false);
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Done', `Admin password updated to: ${newPassword.trim()}`);
    }
  }

  function handleDelete() {
    Alert.alert(
      'Delete event',
      `Delete "${params.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Coming soon', 'Delete will be available in the next update.') },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetBtn} onPress={() => { setNewPassword(''); setConfirmPassword(''); setResetModal(true); }}>
            <Text style={styles.resetBtnText}>🔑 Reset password</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.eventName}>{params.name}</Text>
        <Text style={styles.eventSub}>
          {params.photo_count} photos · Event Code: <Text style={styles.codeHighlight}>{params.join_code}</Text>
        </Text>

        <Text style={styles.sectionLabel}>SHARE</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={copyCode}>
            <Text style={styles.btnText}>📋 Copy Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => router.push({
              pathname: '/(master)/event-qr',
              params: { name: params.name, join_code: params.join_code },
            })}
          >
            <Text style={styles.btnText}>⬛ Show QR</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>DATES</Text>
        <View style={styles.row}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>CREATED</Text>
            <Text style={styles.metaValue}>{formatDate(params.created_at)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>EXPIRES</Text>
            <Text style={styles.metaValue}>{formatDate(params.expires_at)}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>ACTIONS</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={handleExtend}>
            <Text style={styles.btnText}>Extend expiry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={copyAdminDetails}>
            <Text style={styles.btnText}>📋 Copy Admin Details</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.openBtn}
          onPress={() => Alert.alert('Coming soon', 'Event management will be available in Step 3.')}
        >
          <Text style={styles.openBtnText}>Open Event →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Delete event</Text>
        </TouchableOpacity>
      </ScrollView>

      {resetModal && (
        <Modal transparent animationType="fade" onRequestClose={() => setResetModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Reset admin password</Text>
              <View style={styles.modalPasswordRow}>
                <TextInput
                  style={styles.modalPasswordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor="#555"
                  secureTextEntry={!showNew}
                  autoFocus
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.modalEyeBtn} onPress={() => setShowNew(!showNew)}>
                  <Text>{showNew ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modalPasswordRow}>
                <TextInput
                  style={styles.modalPasswordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor="#555"
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.modalEyeBtn} onPress={() => setShowConfirm(!showConfirm)}>
                  <Text>{showConfirm ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setResetModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={submitResetPassword}>
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {promptModal && (
        <Modal transparent animationType="fade" onRequestClose={() => setPromptModal(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>{promptModal.title}</Text>
              <TextInput
                style={styles.modalInput}
                value={promptValue}
                onChangeText={setPromptValue}
                autoFocus
                placeholderTextColor="#555"
                placeholder="Enter value..."
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setPromptModal(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirm}
                  onPress={() => { promptModal.onSubmit(promptValue); setPromptModal(null); }}
                >
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  back: { fontSize: 24, color: Colors.textMuted },
  resetBtn: { backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  resetBtnText: { fontSize: 11, color: '#888', fontWeight: '700' },
  eventName: { fontSize: 22, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  eventSub: { fontSize: 13, color: '#666', marginBottom: 24 },
  codeHighlight: { color: Colors.accent, fontWeight: '800', letterSpacing: 1 },
  sectionLabel: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  btn: { flex: 1, backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, padding: 11, alignItems: 'center' },
  btnText: { fontSize: 11, fontWeight: '700', color: '#CCC' },
  metaItem: { flex: 1, backgroundColor: '#141414', borderRadius: 8, padding: 10 },
  metaLabel: { fontSize: 9, color: '#444', fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  metaValue: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  divider: { height: 0.5, backgroundColor: '#222', marginVertical: 20 },
  openBtn: { backgroundColor: Colors.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  openBtnText: { fontSize: 15, fontWeight: '800', color: Colors.background },
  deleteBtn: { backgroundColor: 'rgba(229,57,53,0.08)', borderWidth: 0.5, borderColor: 'rgba(229,57,53,0.25)', borderRadius: 8, padding: 12, alignItems: 'center' },
  deleteBtnText: { fontSize: 12, fontWeight: '700', color: '#E53935' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalBox: { backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, width: '100%', borderWidth: 0.5, borderColor: '#333' },
  modalTitle: { fontSize: 15, fontWeight: '700', color: Colors.white, marginBottom: 16, lineHeight: 22 },
  modalInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 12, fontSize: 15, color: Colors.white, marginBottom: 20 },
  modalPasswordRow: { flexDirection: 'row', backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 10, marginBottom: 12, alignItems: 'center' },
  modalPasswordInput: { flex: 1, padding: 12, fontSize: 15, color: Colors.white },
  modalEyeBtn: { padding: 12 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#333', alignItems: 'center' },
  modalCancelText: { color: Colors.textMuted, fontWeight: '600' },
  modalConfirm: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: Colors.accent, alignItems: 'center' },
  modalConfirmText: { color: Colors.background, fontWeight: '800' },
});
