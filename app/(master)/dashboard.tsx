import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  FlatList, RefreshControl, ActivityIndicator, BackHandler, TextInput, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getOrganiserPassword, saveOrganiserSession } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { listEvents, organiserChangePassword } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

type Event = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  expires_at: string;
  join_code: string;
  is_closed: boolean;
  allow_guest_delete: boolean;
  photo_count: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DashboardScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const gearRef = useRef<TouchableOpacity>(null);
  const [cpVisible, setCpVisible] = useState(false);
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpShowCurrent, setCpShowCurrent] = useState(false);
  const [cpShowNew, setCpShowNew] = useState(false);
  const [cpShowConfirm, setCpShowConfirm] = useState(false);
  const [cpError, setCpError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [organiserPhone, setOrganiserPhone] = useState<string | null>(null);
  const [organiserPassword, setOrganiserPassword] = useState<string | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  const load = useCallback(async (phone?: string, pw?: string) => {
    const p = phone ?? organiserPhone;
    const pass = pw ?? organiserPassword;
    if (!p || !pass) return;
    try {
      const result = await listEvents(p, pass);
      if (result.events) setEvents(result.events);
    } catch {
      // silently fail on refresh
    }
  }, [organiserPhone, organiserPassword]);

  useEffect(() => {
    (async () => {
      const profile = await getUserProfile();
      const pw = await getOrganiserPassword();
      if (profile && pw) {
        setOrganiserPhone(profile.mobile);
        setOrganiserPassword(pw);
        await load(profile.mobile, pw);
      }
      setLoading(false);
    })();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  function handleSwitchToGuest() {
    router.replace('/(auth)/home');
  }

  async function submitChangePassword() {
    setCpError('');
    if (!cpCurrent.trim() || !cpNew.trim() || !cpConfirm.trim()) {
      setCpError('Please fill in all fields.');
      return;
    }
    if (cpNew.trim().length < 6) {
      setCpError('New password must be at least 6 characters.');
      return;
    }
    if (cpNew.trim() !== cpConfirm.trim()) {
      setCpError('Passwords do not match.');
      return;
    }
    if (!organiserPhone) return;
    const result = await organiserChangePassword(organiserPhone, cpCurrent.trim(), cpNew.trim());
    if (result.error) {
      setCpError(result.error);
    } else {
      await saveOrganiserSession(cpNew.trim());
      setOrganiserPassword(cpNew.trim());
      setCpVisible(false);
      setCpCurrent(''); setCpNew(''); setCpConfirm(''); setCpError('');
      showAlert('Done', 'Organiser password updated successfully.');
    }
  }

  function openEvent(item: Event) {
    router.push({
      pathname: '/(master)/event-detail',
      params: {
        id: item.id,
        name: item.name,
        slug: item.slug,
        join_code: item.join_code,
        created_at: item.created_at,
        expires_at: item.expires_at,
        photo_count: String(item.photo_count),
        is_closed: item.is_closed ? 'true' : 'false',
        allow_guest_delete: item.allow_guest_delete ? 'true' : 'false',
        organiserPhone: organiserPhone ?? '',
      },
    });
  }

  function renderEvent({ item }: { item: Event }) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => openEvent(item)} activeOpacity={0.75}>
        <View style={styles.cardHeader}>
          <Text style={styles.eventName}>{item.name}</Text>
          {item.is_closed && <Text style={styles.closedBadge}>BY INVITE ONLY</Text>}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>EXPIRES</Text>
            <Text style={styles.metaValue}>{formatDate(item.expires_at)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>PHOTOS</Text>
            <Text style={styles.metaValue}>{item.photo_count}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>CODE</Text>
            <Text style={styles.metaValue}>{item.join_code}</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.manageText}>Tap to manage →</Text>
          <TouchableOpacity onPress={() => router.push({
            pathname: '/event',
            params: {
              slug: item.slug,
              name: item.name,
              expiresAt: item.expires_at,
              createdAt: item.created_at,
              isAdmin: 'true',
              adminPhone: organiserPhone ?? '',
              role: 'organiser',
              allowGuestDelete: item.allow_guest_delete ? 'true' : 'false',
            },
          })}>
            <Text style={styles.openEventText}>Open Event →</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.loader} color={Colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Events</Text>
          <Text style={styles.headerSub}>{events.length} event{events.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/(master)/create-event')}>
            <Text style={styles.newBtnText}>+ New event</Text>
          </TouchableOpacity>
          <TouchableOpacity ref={gearRef} style={styles.settingsBtn} onPress={() => {
            gearRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
              setDropPos({ top: pageY + height + 4, right: Dimensions.get('window').width - pageX - width });
              setSettingsVisible(true);
            });
          }}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No events yet. Tap "+ New event" to create one.</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.logoutBtn} onPress={handleSwitchToGuest}>
        <Text style={styles.logoutText}>Switch to Guest →</Text>
      </TouchableOpacity>

      {/* Settings dropdown */}
      {settingsVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setSettingsVisible(false)}>
          <TouchableOpacity style={styles.dropBackdrop} activeOpacity={1} onPress={() => setSettingsVisible(false)}>
            <View style={[styles.dropdown, { position: 'absolute', top: dropPos.top, right: dropPos.right }]}>
              <TouchableOpacity style={styles.dropRow} onPress={() => {
                setSettingsVisible(false);
                setCpCurrent(''); setCpNew(''); setCpConfirm('');
                setCpVisible(true);
              }}>
                <Text style={styles.dropText}>Change Password</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Change password modal */}
      {cpVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setCpVisible(false)}>
          <View style={styles.cpOverlay}>
            <View style={styles.cpBox}>
              <Text style={styles.cpTitle}>Change Organiser Password</Text>
              <View style={styles.cpRow}>
                <TextInput style={styles.cpInput} value={cpCurrent} onChangeText={setCpCurrent}
                  placeholder="Current password" placeholderTextColor="#555"
                  secureTextEntry={!cpShowCurrent} autoFocus autoCapitalize="none" />
                <TouchableOpacity style={styles.cpEye} onPress={() => setCpShowCurrent(!cpShowCurrent)}>
                  <Text>{cpShowCurrent ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cpRow}>
                <TextInput style={styles.cpInput} value={cpNew} onChangeText={setCpNew}
                  placeholder="New password" placeholderTextColor="#555"
                  secureTextEntry={!cpShowNew} autoCapitalize="none" />
                <TouchableOpacity style={styles.cpEye} onPress={() => setCpShowNew(!cpShowNew)}>
                  <Text>{cpShowNew ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cpRow}>
                <TextInput style={styles.cpInput} value={cpConfirm} onChangeText={setCpConfirm}
                  placeholder="Confirm new password" placeholderTextColor="#555"
                  secureTextEntry={!cpShowConfirm} autoCapitalize="none" />
                <TouchableOpacity style={styles.cpEye} onPress={() => setCpShowConfirm(!cpShowConfirm)}>
                  <Text>{cpShowConfirm ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              {cpError ? <Text style={styles.cpError}>{cpError}</Text> : null}
              <View style={styles.cpBtns}>
                <TouchableOpacity style={styles.cpBtnCancel} onPress={() => { setCpVisible(false); setCpError(''); }}>
                  <Text style={styles.cpBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cpBtnPrimary} onPress={submitChangePassword}>
                  <Text style={styles.cpBtnPrimaryText}>Save</Text>
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
  loader: { flex: 1, marginTop: 100 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: '#222',
  },
  headerTitle: { ...Typography.sectionHeading, color: Colors.white },
  headerSub: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  newBtnText: { fontSize: 12, fontWeight: '800', color: Colors.background },
  settingsBtn: { padding: 4 },
  settingsIcon: { fontSize: 20 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder,
    borderRadius: 16, padding: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  eventName: { fontSize: 16, fontWeight: '800', color: Colors.white, flex: 1 },
  closedBadge: { fontSize: 10, fontWeight: '800', color: '#F4B832', borderWidth: 1, borderColor: '#F4B832', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metaItem: { flex: 1, backgroundColor: '#141414', borderRadius: 8, padding: 10 },
  metaLabel: { ...Typography.inputLabel, color: '#555', marginBottom: 3 },
  metaValue: { fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#252525',
  },
  manageText: { fontSize: 13, color: '#888', fontWeight: '700' },
  openEventText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  logoutBtn: { padding: 20, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: '#1A1A1A' },
  logoutText: { ...Typography.buttonText, color: '#666' },
  dropBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  dropdown: { backgroundColor: '#1C1C1C', borderRadius: 12, borderWidth: 0.5, borderColor: '#333', overflow: 'hidden' },
  dropRow: { paddingHorizontal: 16, paddingVertical: 14 },
  dropText: { fontSize: 14, fontWeight: '600', color: Colors.white },
  cpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  cpBox: { backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, width: '100%', borderWidth: 0.5, borderColor: '#333' },
  cpTitle: { fontSize: 15, fontWeight: '700', color: Colors.white, marginBottom: 16 },
  cpRow: { flexDirection: 'row', backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 10, marginBottom: 12, alignItems: 'center' },
  cpInput: { flex: 1, padding: 12, fontSize: 15, color: Colors.white },
  cpEye: { padding: 12 },
  cpError: { fontSize: 13, color: '#E53935', marginBottom: 8 },
  cpBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  cpBtnPrimary: { flex: 1, backgroundColor: Colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  cpBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  cpBtnCancel: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  cpBtnCancelText: { fontSize: 15, fontWeight: '700', color: Colors.textMuted },
});
