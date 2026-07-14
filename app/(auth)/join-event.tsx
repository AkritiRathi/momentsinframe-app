import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { joinEvent, joinEventUser, checkAdminStatus, listEvents, checkEventExists } from '../../lib/api';
import {
  saveLastEventCode, getLastEventCode, getDeviceId, saveEventUserId, getUserProfile,
  saveJoinedEvent, getJoinedEvents, removeJoinedEvent, JoinedEventEntry,
} from '../../lib/storage';
import { getOrganiserPassword } from '../../lib/auth';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function formatExpiry(expiresAt: string): string {
  const d = new Date(expiresAt);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function JoinEventScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [joinedEvents, setJoinedEvents] = useState<JoinedEventEntry[]>([]);
  const [rejoining, setRejoining] = useState<string | null>(null);
  const [eventsModalVisible, setEventsModalVisible] = useState(false);
  const [checkingEvents, setCheckingEvents] = useState(false);

  useEffect(() => {
    async function load() {
      // Show cached events immediately — no server wait
      setJoinedEvents(await getJoinedEvents());
      // Pre-fill last used event code
      const lastCode = await getLastEventCode();
      if (lastCode) setCode(lastCode);
      // Refresh from server in background
      const profile = await getUserProfile();
      const pw = await getOrganiserPassword();
      if (profile?.mobile && pw) {
        try {
          const result = await listEvents(profile.mobile, pw);
          if (result.events) {
            await Promise.all(result.events.map((ev: any) => saveJoinedEvent({
              slug: ev.slug,
              name: ev.name,
              expiresAt: ev.expires_at,
              joinCode: ev.join_code ?? '',
              createdAt: ev.created_at ?? new Date().toISOString(),
              allowGuestDelete: ev.allow_guest_delete ?? false,
              isOrganiser: true,
            })));
            // Remove cached organiser events that no longer exist on server (deleted)
            const serverSlugs = new Set(result.events.map((ev: any) => ev.slug));
            const cached = await getJoinedEvents();
            await Promise.all(cached.filter(e => e.isOrganiser && !serverSlugs.has(e.slug)).map(e => removeJoinedEvent(e.slug)));
          }
        } catch { /* silent — show whatever is cached */ }
      }
      setJoinedEvents(await getJoinedEvents());
    }
    load();
  }, []);

  function handleCodeChange(value: string) {
    setCode(value.replace(/[^0-9]/g, '').slice(0, 6));
  }

  async function attemptJoin(joinCode: string) {
    if (joinCode.length !== 6) {
      showAlert('Invalid code', 'Please enter a 6-digit event code.');
      return;
    }
    setLoading(true);
    try {
      const profile = await getUserProfile();
      const result = await joinEvent(joinCode, profile?.mobile);
      if (result.error) {
        if (result.error === 'This event has expired.') {
          const cached = await getJoinedEvents();
          const match = cached.find(e => e.joinCode === joinCode);
          if (match) await removeJoinedEvent(match.slug);
          setJoinedEvents(await getJoinedEvents());
          const eventName = match?.name ?? 'This event';
          showAlert('Event expired', `${eventName} has expired.`, [
            { text: 'OK', onPress: () => setCode('') },
          ]);
        } else {
          showAlert('Could not join', result.error, [
            { text: 'Try again', onPress: () => setCode('') },
          ]);
        }
        return;
      }
      await saveLastEventCode(joinCode);
      let isAdmin = false;
      let adminRole = '';
      if (profile?.mobile) {
        const adminCheck = await checkAdminStatus(result.event.slug, profile.mobile);
        isAdmin = adminCheck.isAdmin ?? false;
        adminRole = adminCheck.role ?? '';
      }
      if (profile) {
        getDeviceId().then(async deviceId => {
          const userResult = await joinEventUser(result.event.slug, `${profile.firstName} ${profile.lastName}`, profile.mobile, deviceId);
          if (userResult.eventUserId) await saveEventUserId(userResult.eventUserId);
        }).catch(() => {});
      }
      await saveJoinedEvent({
        slug: result.event.slug,
        name: result.event.name,
        expiresAt: result.event.expires_at,
        joinCode,
        createdAt: result.event.created_at ?? new Date().toISOString(),
        allowGuestDelete: result.event.allow_guest_delete ?? false,
      });
      router.replace({
        pathname: '/event',
        params: {
          slug: result.event.slug,
          name: result.event.name,
          expiresAt: result.event.expires_at,
          createdAt: result.event.created_at ?? new Date().toISOString(),
          isAdmin: isAdmin ? 'true' : 'false',
          adminPhone: isAdmin ? (profile?.mobile ?? '') : '',
          allowGuestDelete: result.event.allow_guest_delete ? 'true' : 'false',
          joinCode,
          role: adminRole,
        },
      });
    } catch {
      showAlert('Error', 'Something went wrong. Please check your connection and try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  async function handleRejoin(entry: JoinedEventEntry) {
    setRejoining(entry.slug);
    try {
      const profile = await getUserProfile();
      let isAdmin = entry.isOrganiser ?? false;
      let adminRole = isAdmin ? 'organiser' : '';
      if (!isAdmin && profile?.mobile) {
        const adminCheck = await checkAdminStatus(entry.slug, profile.mobile);
        isAdmin = adminCheck.isAdmin ?? false;
        adminRole = adminCheck.role ?? '';
      }
      router.replace({
        pathname: '/event',
        params: {
          slug: entry.slug,
          name: entry.name,
          expiresAt: entry.expiresAt,
          createdAt: entry.createdAt,
          isAdmin: isAdmin ? 'true' : 'false',
          adminPhone: isAdmin ? (profile?.mobile ?? '') : '',
          allowGuestDelete: entry.allowGuestDelete ? 'true' : 'false',
          joinCode: entry.joinCode,
          role: adminRole,
        },
      });
    } catch {
      showAlert('Error', 'Could not open event. Please try again.');
    } finally {
      setRejoining(null);
    }
  }

  function renderEventCard(item: JoinedEventEntry) {
    const expired = isExpired(item.expiresAt);
    return (
      <TouchableOpacity
        key={item.slug}
        style={[styles.eventCard, expired && !item.isOrganiser && styles.eventCardExpired]}
        onPress={() => {
          if (!expired || item.isOrganiser) {
            setEventsModalVisible(false);
            setTimeout(() => handleRejoin(item), 300);
          }
        }}
        disabled={(!item.isOrganiser && expired) || rejoining === item.slug}
        activeOpacity={expired ? 1 : 0.7}
      >
        <View style={styles.eventCardLeft}>
          <Text style={[styles.eventName, expired && styles.eventNameExpired]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.eventExpiry}>
            {item.isOrganiser && <Text style={styles.organiserPrefix}>Organiser · </Text>}
            {expired ? 'Expired' : `Active · expires ${formatExpiry(item.expiresAt)}`}
          </Text>
        </View>
        {rejoining === item.slug
          ? <ActivityIndicator size="small" color={Colors.accent} />
          : !expired && <Text style={styles.eventArrow}>›</Text>
        }
        {expired && <View style={styles.expiredBadge}><Text style={styles.expiredBadgeText}>Expired</Text></View>}
      </TouchableOpacity>
    );
  }

  async function handleOpenEvents() {
    if (visibleEvents.length === 0) return;
    setCheckingEvents(true);
    // Check non-organiser events still exist on server; remove deleted ones from cache
    const guestEvents = visibleEvents.filter(e => !e.isOrganiser);
    await Promise.all(guestEvents.map(async (e) => {
      const exists = await checkEventExists(e.slug);
      if (!exists) await removeJoinedEvent(e.slug);
    }));
    setJoinedEvents(await getJoinedEvents());
    setCheckingEvents(false);
    setEventsModalVisible(true);
  }

  const visibleEvents = joinedEvents.filter(e => !isExpired(e.expiresAt) || e.isOrganiser);

  return (
    <SafeAreaView style={styles.container}>
      {/* Current Event modal */}
      <Modal
        visible={eventsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEventsModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setEventsModalVisible(false)}
        >
          <View
            style={[styles.eventsSheet, { paddingBottom: insets.bottom + 16 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Your Events</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {visibleEvents.map(renderEventCard)}
            </ScrollView>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEventsModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Guest login</Text>
        <Text style={styles.subtitle}>Enter a 6-digit event code to join{visibleEvents.length > 0 ? ', or open a previous event.' : '.'}</Text>

        <Text style={styles.sectionLabel}>CURRENT EVENT</Text>
        <TouchableOpacity
          style={[styles.currentEventRow, visibleEvents.length === 0 && { opacity: 0.4 }]}
          onPress={handleOpenEvents}
          activeOpacity={visibleEvents.length > 0 ? 0.7 : 1}
          disabled={checkingEvents || visibleEvents.length === 0}
        >
          <Text style={styles.currentEventText}>Your events ({visibleEvents.length})</Text>
          {checkingEvents
            ? <ActivityIndicator size="small" color={Colors.accent} />
            : visibleEvents.length > 0 && <Text style={styles.eventArrow}>›</Text>
          }
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>JOIN A NEW EVENT</Text>
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
        />

        <TouchableOpacity
          style={[styles.joinBtn, (code.length !== 6 || loading) && { opacity: 0.4 }]}
          onPress={() => attemptJoin(code)}
          disabled={code.length !== 6 || loading}
        >
          {loading
            ? <ActivityIndicator color={Colors.background} />
            : <Text style={styles.joinBtnText}>Join Event</Text>
          }
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.qrButton} onPress={() => showAlert('Coming soon', 'QR scanner will be added shortly.')}>
          <Text style={styles.qrIcon}>📷</Text>
          <Text style={styles.qrText}>Scan QR code instead</Text>
        </TouchableOpacity>
      </ScrollView>
      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  back: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  scroll: { padding: 24, paddingTop: 8 },
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 28 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: Colors.accent, marginBottom: 12, marginTop: 4 },

  currentEventRow: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  currentEventText: { fontSize: 15, fontWeight: '600', color: Colors.white },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  eventsSheet: {
    backgroundColor: '#1C1C1C',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, textAlign: 'center', marginBottom: 16 },
  cancelBtn: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textMuted },

  eventCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  eventCardExpired: { opacity: 0.45 },
  eventCardLeft: { flex: 1 },
  eventName: { fontSize: 15, fontWeight: '700', color: Colors.white, marginBottom: 3 },
  eventNameExpired: { color: Colors.textMuted },
  eventExpiry: { fontSize: 12, color: Colors.textMuted },
  eventArrow: { fontSize: 22, color: Colors.accent, marginLeft: 8 },
  organiserPrefix: { color: Colors.accent, fontWeight: '700' },
  organiserBadge: {
    backgroundColor: '#2a2200',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  organiserBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.accent },
  expiredBadge: {
    backgroundColor: '#2a1a1a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  expiredBadgeText: { fontSize: 11, fontWeight: '700', color: '#c0392b' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: Colors.accent, marginBottom: 12 },
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
  joinBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  joinBtnText: { ...Typography.buttonText, color: Colors.background },
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
