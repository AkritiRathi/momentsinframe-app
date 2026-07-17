import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { listWhitelist, addToWhitelist, removeFromWhitelist } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

const MASTER_PHONE = '8826388888';

type Entry = { phone: string; added_at: string };

export default function WhitelistScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [organiserPhone, setOrganiserPhone] = useState('');
  const [organiserPassword, setOrganiserPassword] = useState('');

  const [addVisible, setAddVisible] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const profile = await getUserProfile();
      const pw = await getOrganiserPassword();
      if (!profile?.mobile || profile.mobile !== MASTER_PHONE || !pw) {
        router.back();
        return;
      }
      setOrganiserPhone(profile.mobile);
      setOrganiserPassword(pw);
      await loadList(profile.mobile, pw);
    })();
  }, []);

  async function loadList(phone: string, pw: string) {
    setLoading(true);
    const result = await listWhitelist(phone, pw);
    if (result.phones) setEntries(result.phones);
    setLoading(false);
  }

  async function handleAdd() {
    setAddError('');
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setAddError('Enter a valid 10-digit mobile number.');
      return;
    }
    setAddLoading(true);
    const result = await addToWhitelist(organiserPhone, organiserPassword, cleaned);
    setAddLoading(false);
    if (result.error) {
      setAddError(result.error);
    } else {
      setAddVisible(false);
      setNewPhone('');
      await loadList(organiserPhone, organiserPassword);
    }
  }

  async function handleRemove(phone: string) {
    showAlert(
      'Remove number',
      `Remove ${phone} from the whitelist? They will no longer be able to create organiser accounts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const result = await removeFromWhitelist(organiserPhone, organiserPassword, phone);
            if (result.error) {
              showAlert('Error', result.error);
            } else {
              await loadList(organiserPhone, organiserPassword);
            }
          },
        },
      ]
    );
  }

  function renderEntry({ item }: { item: Entry }) {
    const isMaster = item.phone === MASTER_PHONE;
    return (
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowPhone}>{item.phone}</Text>
          {isMaster && <Text style={styles.masterBadge}>MASTER</Text>}
        </View>
        {!isMaster && (
          <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item.phone)}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Organiser Whitelist</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => { setNewPhone(''); setAddError(''); setAddVisible(true); }}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>
        Only numbers on this list can register as organisers.
      </Text>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={Colors.accent} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.phone}
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No numbers whitelisted yet.</Text>
          }
        />
      )}

      {/* Add number modal */}
      {addVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
          <View style={styles.overlay}>
            <View style={styles.box}>
              <Text style={styles.boxTitle}>Add number</Text>
              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor="#555"
                keyboardType="phone-pad"
                value={newPhone}
                onChangeText={setNewPhone}
                maxLength={10}
              />
              {addError ? <Text style={styles.errorText}>{addError}</Text> : null}
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddVisible(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleAdd} disabled={addLoading}>
                  {addLoading ? (
                    <ActivityIndicator size="small" color={Colors.background} />
                  ) : (
                    <Text style={styles.confirmBtnText}>Add</Text>
                  )}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#222',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 14, color: Colors.accent, fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '800', color: Colors.white },
  addBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontWeight: '800', color: Colors.background },
  subtitle: { fontSize: 13, color: Colors.textMuted, paddingHorizontal: 20, paddingVertical: 12 },
  loader: { marginTop: 60 },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 0.5,
    borderColor: '#252525', paddingHorizontal: 16, paddingVertical: 14,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowPhone: { fontSize: 15, fontWeight: '700', color: Colors.white },
  masterBadge: {
    fontSize: 10, fontWeight: '800', color: Colors.accent,
    borderWidth: 1, borderColor: Colors.accent, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  removeBtn: { borderWidth: 1, borderColor: '#444', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  removeBtnText: { fontSize: 13, color: '#E53935', fontWeight: '600' },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 60 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  box: { backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, width: '100%', borderWidth: 0.5, borderColor: '#333' },
  boxTitle: { fontSize: 15, fontWeight: '700', color: Colors.white, marginBottom: 16 },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#333',
    borderRadius: 10, padding: 12, fontSize: 15, color: Colors.white, marginBottom: 8,
  },
  errorText: { fontSize: 13, color: '#E53935', marginBottom: 8 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cancelBtn: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  cancelBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textMuted },
  confirmBtn: { flex: 1, backgroundColor: Colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
