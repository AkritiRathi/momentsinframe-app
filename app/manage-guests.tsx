import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { listJoinedGuestsForUser, setGuestBlockedByUser } from '../lib/api';
import { getUserProfile } from '../lib/storage';
import { Colors } from '../constants/colors';
import { useAlert } from '../lib/useAlert';

type Guest = {
  name: string;
  mobile: string;
  is_blocked: boolean;
  photo_count?: number;
  role: 'organiser' | 'coadmin' | 'user';
};

function normalizeIndianPhone(raw: string): string {
  let n = raw.replace(/\D/g, '');
  if (n.startsWith('0091')) n = n.slice(4);
  else if (n.startsWith('91') && n.length === 12) n = n.slice(2);
  else if (n.startsWith('0') && n.length === 11) n = n.slice(1);
  return n;
}

export default function ManageGuestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    slug: string;
    adminPhone: string;
    viewerRole: string;
    userMobile: string;
    eventName: string;
  }>();
  const { showAlert } = useAlert();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [totalPhotos, setTotalPhotos] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingGuest, setTogglingGuest] = useState<string | null>(null);
  const [contactMap, setContactMap] = useState<Record<string, string>>({});

  useEffect(() => { loadGuests(); }, []);

  async function loadGuests() {
    const phone = params.userMobile || params.adminPhone;
    if (!phone) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listJoinedGuestsForUser(params.slug, phone);
      if (result.guests) {
        const ownerPhone = result.owner_phone ?? params.adminPhone;
        const roleOrder: Record<string, number> = { organiser: 0, coadmin: 1, user: 2 };
        let allGuests: Guest[] = [...result.guests].sort((a, b) =>
          (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2)
        );
        if (!allGuests.some(g => g.role === 'organiser') && ownerPhone) {
          allGuests = [{ name: 'Organiser', mobile: ownerPhone, is_blocked: false, photo_count: 0, role: 'organiser' }, ...allGuests];
        }
        if (params.viewerRole === 'organiser') {
          const profile = await getUserProfile();
          if (profile) {
            const organiserName = `${profile.firstName} ${profile.lastName}`.trim();
            allGuests = allGuests.map(g => g.role === 'organiser' ? { ...g, name: organiserName } : g);
          }
        }
        setGuests(allGuests);
        setTotalPhotos(result.total_photo_count ?? null);
        try {
          const { status } = await Contacts.getPermissionsAsync();
          if (status === 'granted') {
            const { data: allContacts } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
            const map: Record<string, string> = {};
            for (const guest of result.guests) {
              const match = allContacts.find(c =>
                (c.phoneNumbers ?? []).some(pn => normalizeIndianPhone(pn.number ?? '') === guest.mobile)
              );
              if (match?.name) map[guest.mobile] = match.name;
            }
            setContactMap(map);
          }
        } catch {}
      } else {
        setError(result.error ?? 'Could not load guests.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleBlock(mobile: string, currentlyBlocked: boolean) {
    const phone = params.userMobile || params.adminPhone;
    if (!phone) return;
    setTogglingGuest(mobile);
    const result = await setGuestBlockedByUser(params.slug, mobile, !currentlyBlocked, phone);
    setTogglingGuest(null);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setGuests(prev => prev.map(g => g.mobile === mobile ? { ...g, is_blocked: !currentlyBlocked } : g));
    }
  }

  const guestCount = guests.filter(g => g.role !== 'organiser').length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.title}>
          Manage Guests{guestCount > 0 ? ` (${guestCount})` : ''}{totalPhotos != null ? ` · ${totalPhotos} photos` : ''}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.close}>×</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.desc}>Block a guest to remove their access to this event. They will not be able to rejoin. You can unblock them at any time.</Text>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadGuests} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : guests.length <= 1 ? (
          <>
            {guests.map(guest => {
              const contactName = contactMap[guest.mobile];
              const displayName = contactName || guest.name || guest.mobile;
              const subName = contactName && guest.name && guest.name !== contactName ? guest.name : null;
              return (
                <TouchableOpacity key={guest.mobile} style={styles.row} activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/guest-uploads', params: { slug: params.slug, adminPhone: params.userMobile || params.adminPhone || '', viewerRole: params.viewerRole, guestMobile: guest.mobile, guestName: guest.name || guest.mobile, guestRole: guest.role, guestContactName: contactMap[guest.mobile] ?? '', eventName: params.eventName ?? '' } })}>
                  <View style={styles.guestInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.guestName}>{displayName}</Text>
                      <Text style={[styles.guestSub, { marginLeft: 6 }]}>· {guest.photo_count ?? 0} photos</Text>
                    </View>
                    {subName ? <Text style={styles.guestSub}>{subName}</Text> : null}
                    <Text style={styles.guestSub}>{guest.mobile}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <Text style={[styles.emptyText, { marginTop: 12 }]}>No guests have joined this event yet.</Text>
          </>
        ) : (
          guests.map(guest => {
            const contactName = contactMap[guest.mobile] ?? null;
            const appName = guest.name || guest.mobile;
            return (
              <TouchableOpacity key={guest.mobile} style={[styles.row, guest.is_blocked && styles.blockedRow]} activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/guest-uploads', params: { slug: params.slug, adminPhone: params.userMobile || params.adminPhone || '', viewerRole: params.viewerRole, guestMobile: guest.mobile, guestName: guest.name || guest.mobile, guestRole: guest.role, guestContactName: contactMap[guest.mobile] ?? '', eventName: params.eventName ?? '' } })}>
                <View style={styles.guestInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.guestName, guest.is_blocked && styles.blockedText]}>{appName}</Text>
                    <Text style={[styles.guestSub, { marginLeft: 6 }, guest.is_blocked && styles.blockedText]}>· {guest.photo_count ?? 0} photos</Text>
                  </View>
                  <Text style={[styles.guestSub, guest.is_blocked && styles.blockedText]}>{contactName || 'Number not in contacts'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.guestSub, guest.is_blocked && styles.blockedText]}>{guest.mobile}</Text>
                    {guest.is_blocked && <Text style={[styles.blockedBadge, { marginLeft: 6 }]}>· BLOCKED</Text>}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {guest.role === 'coadmin' && <Text style={styles.coadminBadge}>Co-Admin</Text>}
                  {guest.role !== 'organiser' && guest.mobile !== params.userMobile && (params.viewerRole === 'organiser' || guest.role === 'user') && (
                    togglingGuest === guest.mobile ? (
                      <ActivityIndicator size="small" color={Colors.accent} />
                    ) : (
                      <TouchableOpacity
                        style={[styles.blockBtn, guest.is_blocked && styles.unblockBtn]}
                        onPress={(e) => { e.stopPropagation(); handleToggleBlock(guest.mobile, guest.is_blocked); }}
                      >
                        <Text style={[styles.blockBtnText, guest.is_blocked && styles.unblockBtnText]}>
                          {guest.is_blocked ? 'Unblock' : 'Block'}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.white },
  close: { fontSize: 28, color: Colors.textMuted, paddingHorizontal: 4 },
  desc: { fontSize: 13, color: Colors.textMuted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, lineHeight: 19 },
  scroll: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#2A2A2A' },
  guestInfo: { flex: 1 },
  guestName: { fontSize: 14, fontWeight: '700', color: Colors.white },
  guestSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  blockedRow: { opacity: 0.6 },
  blockedText: { color: Colors.textMuted },
  blockedBadge: { fontSize: 10, fontWeight: '800', color: '#E53935' },
  coadminBadge: { fontSize: 11, fontWeight: '700', color: Colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 0.5, borderColor: Colors.accent, overflow: 'hidden' },
  blockBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 6, borderWidth: 0.5, borderColor: 'rgba(229,57,53,0.4)' },
  blockBtnText: { fontSize: 12, fontWeight: '700', color: '#E53935' },
  unblockBtn: { backgroundColor: 'rgba(100,220,100,0.08)', borderColor: 'rgba(100,220,100,0.3)' },
  unblockBtnText: { color: '#4CAF50' },
  emptyText: { fontSize: 13, color: '#555', textAlign: 'center', marginTop: 32 },
  errorBox: { alignItems: 'center', paddingVertical: 24 },
  errorText: { fontSize: 13, color: '#E53935', textAlign: 'center', marginBottom: 12 },
  retryBtn: { borderWidth: 1, borderColor: '#444', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
});
