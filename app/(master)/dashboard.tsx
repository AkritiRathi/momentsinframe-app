import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, RefreshControl, ActivityIndicator, Alert, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { getMasterPassword, clearMasterSession } from '../../lib/auth';
import { listEvents } from '../../lib/api';
import { Colors } from '../../constants/colors';

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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const load = useCallback(async (mp?: string) => {
    const pw = mp ?? masterPassword;
    if (!pw) return;
    try {
      const result = await listEvents(pw);
      if (result.events) setEvents(result.events);
    } catch {
      // silently fail on refresh
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

  function openEvent(item: Event) {
    router.push({
      pathname: '/(master)/event-detail',
      params: {
        id: item.id,
        name: item.name,
        slug: item.slug,
        join_code: item.join_code,
        event_admin_password: item.event_admin_password,
        created_at: item.created_at,
        expires_at: item.expires_at,
        photo_count: String(item.photo_count),
      },
    });
  }

  function renderEvent({ item }: { item: Event }) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => openEvent(item)} activeOpacity={0.75}>
        <Text style={styles.eventName}>{item.name}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>EXPIRES</Text>
            <Text style={styles.metaValue}>{formatDate(item.expires_at)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>PHOTOS</Text>
            <Text style={styles.metaValue}>{item.photo_count} photos</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.manageText}>Tap to manage →</Text>
          <TouchableOpacity onPress={() => Alert.alert('Coming soon', 'Event management will be available in Step 3.')}>

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
          <Text style={styles.headerTitle}>All Events</Text>
          <Text style={styles.headerSub}>Master Admin · {events.length} event{events.length !== 1 ? 's' : ''}</Text>
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
        <Text style={styles.logoutText}>Logout Master Admin</Text>
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
  eventName: { fontSize: 16, fontWeight: '800', color: Colors.white, marginBottom: 12 },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metaItem: { flex: 1, backgroundColor: '#141414', borderRadius: 8, padding: 10 },
  metaLabel: { fontSize: 10, color: '#555', fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 },
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
  logoutText: { fontSize: 15, color: '#666', fontWeight: '600' },
});
