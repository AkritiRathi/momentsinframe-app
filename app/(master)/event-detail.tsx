import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Clipboard } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { getMasterPassword } from '../../lib/auth';
import { extendEvent, changeEventAdminPassword, deleteEvent, verifyMasterPassword } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function EventDetailScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const params = useLocalSearchParams<{
    id: string; name: string; slug: string; join_code: string;
    event_admin_password: string; created_at: string; expires_at: string; photo_count: string;
  }>();

  const [currentAdminPassword, setCurrentAdminPassword] = useState(params.event_admin_password);
  const [resetModal, setResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteMasterPw, setDeleteMasterPw] = useState('');
  const [deleteShowPw, setDeleteShowPw] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);


  function copyCode() {
    const text = `Event: ${params.name}\nEvent Code: ${params.join_code}`;
    Clipboard.setString(text);
    showAlert('Copied', `Event: ${params.name}\nEvent Code: ${params.join_code}`);
  }

  function copyAdminDetails() {
    const text = `Event: ${params.name}\nEvent Code: ${params.join_code}\nAdmin Password: ${currentAdminPassword}`;
    Clipboard.setString(text);
    showAlert('Copied', `Event: ${params.name}\nEvent Code: ${params.join_code}\nAdmin Password: ${currentAdminPassword}`);
  }

  async function handleExtend() {
    const current = params.expires_at ? new Date(params.expires_at) : new Date();
    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      minimumDate: new Date(),
      onChange: async (event, date) => {
        if (event.type !== 'set' || !date) return;
        const iso = date.toISOString().split('T')[0];
        const pw = await getMasterPassword();
        if (!pw) return;
        const result = await extendEvent(params.slug, pw, iso);
        if (result.error) {
          showAlert('Error', result.error);
        } else {
          showAlert('Done', 'Expiry date updated.', [{ text: 'OK', onPress: () => router.back() }]);
        }
      },
    });
  }

  async function submitResetPassword() {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      showAlert('Missing fields', 'Please fill in both fields.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      showAlert('Mismatch', 'Passwords do not match.');
      return;
    }
    const pw = await getMasterPassword();
    if (!pw) return;
    const result = await changeEventAdminPassword(params.slug, pw, newPassword.trim());
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setCurrentAdminPassword(newPassword.trim());
      setResetModal(false);
      setNewPassword('');
      setConfirmPassword('');
      showAlert('Done', `Admin password updated to: ${newPassword.trim()}`);
    }
  }

  function handleDelete() {
    setDeleteMasterPw('');
    setDeleteError('');
    setDeleteModal(true);
  }

  async function submitDelete() {
    setDeleteError('');
    if (!deleteMasterPw.trim()) {
      setDeleteError('Please enter the master password.');
      return;
    }
    const pw = deleteMasterPw.trim();
    setVerifyLoading(true);
    const verifyResult = await verifyMasterPassword(pw);
    setVerifyLoading(false);
    if (verifyResult.error) {
      setDeleteError(verifyResult.error);
      return;
    }
    setDeleteModal(false);
    showAlert(
      `Delete "${params.name}"?`,
      'This action is permanent and cannot be undone. All photos will be deleted.',
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleteLoading(true);
            const result = await deleteEvent(params.slug, pw);
            setDeleteLoading(false);
            if (result.error) {
              showAlert('Error', result.error);
            } else {
              router.replace('/(master)/dashboard');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
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
            <Text style={styles.resetBtnText}>Reset password</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.eventName}>{params.name}</Text>
        <Text style={styles.eventSub}>
          {params.photo_count} photos · Event Code: <Text style={styles.codeHighlight}>{params.join_code}</Text>
        </Text>

        <Text style={styles.sectionLabel}>SHARE</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={copyCode}>
            <Text style={styles.btnText}>Copy Event Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => router.push({
              pathname: '/(master)/event-qr',
              params: { name: params.name, join_code: params.join_code },
            })}
          >
            <Text style={styles.btnText}>Show QR</Text>
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
            <Text style={styles.btnText}>Copy Admin Details</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.openBtn}
          onPress={() => router.push({
            pathname: '/event',
            params: {
              slug: params.slug,
              name: params.name,
              expiresAt: params.expires_at,
              createdAt: params.created_at,
              isAdmin: 'true',
              adminPassword: currentAdminPassword,
            },
          })}
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


      {deleteLoading && (
        <Modal transparent animationType="fade">
          <View style={styles.deletingOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.deletingText}>Deleting event...</Text>
          </View>
        </Modal>
      )}

      {deleteModal && (
        <Modal transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Verify master password</Text>
              <Text style={styles.deleteWarning}>
                ⚠️ This action is permanent and cannot be undone. All photos will be deleted.
              </Text>
              <View style={styles.modalPasswordRow}>
                <TextInput
                  style={styles.modalPasswordInput}
                  value={deleteMasterPw}
                  onChangeText={setDeleteMasterPw}
                  placeholder="Master password"
                  placeholderTextColor="#555"
                  secureTextEntry={!deleteShowPw}
                  autoFocus
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.modalEyeBtn} onPress={() => setDeleteShowPw(!deleteShowPw)}>
                  <Text>{deleteShowPw ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setDeleteModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteConfirmBtn} onPress={submitDelete} disabled={verifyLoading}>
                  <Text style={styles.deleteConfirmText}>{verifyLoading ? '...' : 'Continue'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  back: { fontSize: 24, color: Colors.textMuted },
  resetBtn: { backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  resetBtnText: { fontSize: 13, fontWeight: '700', color: '#888' },
  eventName: { ...Typography.eventName, color: Colors.white, marginBottom: 4 },
  eventSub: { ...Typography.body, color: '#666', marginBottom: 24 },
  codeHighlight: { color: Colors.accent, fontWeight: '800', letterSpacing: 1 },
  sectionLabel: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  btn: { flex: 1, backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, padding: 11, alignItems: 'center' },
  btnText: { fontSize: 13, fontWeight: '700', color: '#CCC' },
  metaItem: { flex: 1, backgroundColor: '#252525', borderRadius: 8, padding: 10 },
  metaLabel: { ...Typography.inputLabel, color: Colors.textMuted, marginBottom: 2 },
  metaValue: { ...Typography.body, color: Colors.textMuted, fontWeight: '600' },
  divider: { height: 0.5, backgroundColor: '#222', marginVertical: 20 },
  openBtn: { backgroundColor: Colors.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  openBtnText: { ...Typography.buttonText, color: Colors.background },
  deleteBtn: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: 'rgba(229,57,53,0.6)', borderRadius: 8, padding: 12, alignItems: 'center' },
  deleteBtnText: { ...Typography.buttonText, color: '#E53935' },
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
  deleteWarning: { fontSize: 13, color: '#E53935', marginBottom: 14, lineHeight: 19 },
  deleteError: { fontSize: 13, color: '#E53935', marginBottom: 8 },
  deleteConfirmBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: 'rgba(229,57,53,0.6)', alignItems: 'center' },
  deleteConfirmText: { color: '#E53935', fontWeight: '700' },
  deletingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', gap: 16 },
  deletingText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
