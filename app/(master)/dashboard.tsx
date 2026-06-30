import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  FlatList, Alert, Clipboard, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { getMasterPassword, clearMasterSession } from '@/lib/auth';
import { listEvents, extendEvent } from '@/lib/api';
import { Colors } from '@/constants/colors';

type Event = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  expires_at: string;
  join_code: string;
  event_admin_password: string;
  photo_count: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DashboardScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);

  const load = useCallback(async (mp?: string) => {
    const pw = mp ?? masterPassword;
    if (!pw) return;
    try {
      const result = await listEvents(pw);
      if (result.events) setEvents(result.events);
    } catch {
      Alert.alert('Error', 'Could not load events.');
    }
  }, [masterPassword]);

  useEffect(() => {
    (async () => {
      const pw = await getMasterPassword();
      setMasterPassword(pw);
      if (pw) await load(pw);
      setLoading(false);
    })();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  async function handleLogout() {
    await clearMasterSession();
    router.replace('/(auth)/home');
  }

  function copyCode(code: string) {
    Clipboard.setString(code);
    Alert.alert('Copied', `Event code ${code} copied to clipboard.`);
  }

  function copyAdminDetails(event: Event) {
    const text = `Event: ${event.name}\nEvent Code: ${event.join_code}\nAdmin Password: ${event.event_admin_password}`;
    Clipboard.setString(text);
    Alert.alert('Copied', 'Admin details copied to clipboard.');
  }

  async function handleExtend(event: Event) {
    if (!masterPassword) return;
    Alert.prompt(
      'Extend expiry',
      'Enter new expiry date (YYYY-MM-DD):',
      async (newDate) => {
        if (!newDate) return;
        const result = await extendEvent(event.slug, masterPassword, newDate);
        if (result.error) {
          Alert.alert('Error', result.error);
        } else {
          Alert.alert('Done', 'Expiry date updated.');
          await load();
        }
      },
      'plain-text',
    );
  }

  function renderEvent({ item }: { item: Event }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.eventName}>{item.name}</Text>
            <Text style={styles.eventCode}>{item.join_code}</Text>
          </View>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => Alert.alert('Delete event', `Delete "${item.name}"? This cannot be undone.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Coming soon', 'Delete will be available in the next update.') },
            ])}
          >
            <Text style={styles.deleteBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.copyRow}>
          <TouchableOpacity style={styles.copyBtn} onPress={() => copyCode(item.join_code)}>
            <Text style={styles.copyBtnText}>📋 Copy code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.copyBtn} onPress={() => copyAdminDetails(item)}>
            <Text style={styles.copyBtnText}>📋 Copy admin details</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>CREATED</Text>
            <Text style={styles.metaValue}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>EXPIRES</Text>
            <Text style={styles.metaValue}>{formatDate(item.expires_at)}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.photoCount}>📷 {item.photo_count} photos</Text>
          <View style={styles.footerRight}>
            <TouchableOpacity style={styles.extendBtn} onPress={() => handleExtend(item)}>
              <Text style={styles.extendBtnText}>Extend expiry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Alert.alert('Coming soon', 'Event management will be available in Step 3.')}>
              <Text style={styles.openEventText}>Open Event →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
          <Text style={styles.headerTitle}>All Events</Text>
          <Text style={styles.headerSub}>Master admin · {events.length} event{events.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/(master)/create-event')}>
            <Text style={styles.newBtnText}>+ New event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/(master)/change-master-password')}>
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

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout master admin</Text>
      </TouchableOpacity>
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.white },
  headerSub: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardHeaderLeft: { flex: 1 },
  eventName: { fontSize: 15, fontWeight: '800', color: Colors.white, marginBottom: 2 },
  eventCode: { fontSize: 14, fontWeight: '800', color: Colors.accent, letterSpacing: 3 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 18 },
  copyRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  copyBtn: {
    flex: 1, backgroundColor: '#252525', borderWidth: 1, borderColor: '#333',
    borderRadius: 8, padding: 9, alignItems: 'center',
  },
  copyBtnText: { fontSize: 11, fontWeight: '700', color: '#CCC' },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metaItem: { flex: 1, backgroundColor: '#141414', borderRadius: 8, padding: 10 },
  metaLabel: { fontSize: 9, color: '#444', fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  metaValue: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#252525',
  },
  photoCount: { fontSize: 12, color: '#666' },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  extendBtn: { backgroundColor: '#2A2A2A', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  extendBtnText: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  openEventText: { fontSize: 12, fontWeight: '700', color: Colors.accent },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  logoutBtn: { padding: 20, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: '#1A1A1A' },
  logoutText: { fontSize: 13, color: '#444', fontWeight: '600' },
});
