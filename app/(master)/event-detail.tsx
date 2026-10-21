import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Switch, BackHandler, TextInput, Platform, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Clipboard } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Contacts from 'expo-contacts';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { showPermissionDeniedAlert, shouldShowDeniedAlert } from '../../lib/priming';
import { useAppPermission } from '../../lib/permissions';
import { extendEvent, deleteEvent, listCoadmins, addCoadmin, removeCoadmin, updateEventSettings, listAllowedGuests, addAllowedGuests, removeAllowedGuest, listJoinedGuestsForUser, setGuestBlocked } from '../../lib/api';
import { API_BASE_URL } from '../../constants/config';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

// ⛔ ONE MATCH RULE FOR EVERY PEOPLE-SEARCH ON THIS SCREEN. Four lists use
// it, so they cannot drift apart. It matches anything a row can DISPLAY: the
// name from the organiser's contacts, the name the person registered with,
// any name stored when they were invited, and the number.
// ⭐ The principle: IF YOU CAN SEE IT, YOU CAN SEARCH IT. A row that shows a
// name you cannot find by typing it reads as a broken search.
function matchesPersonSearch(query: string, phone: string, ...names: (string | null | undefined)[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((phone ?? '').includes(q)) return true;
  return names.some(n => (n ?? '').toLowerCase().includes(q));
}

// One definition so all four boxes look and behave identically.
function SearchBox({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <View style={styles.pickerSearchWrap}>
      <TextInput
        style={styles.pickerSearch}
        value={value}
        onChangeText={onChange}
        placeholder="Search by name or number"
        placeholderTextColor="#555"
        autoCorrect={false}
      />
    </View>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatStorage(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

type Coadmin = { phone: string; name: string | null; appName?: string | null; added_at: string };
type AllowedGuest = { phone: string; name: string | null; appName?: string | null; added_at: string; photo_count?: number };

export default function EventDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();
  const params = useLocalSearchParams<{
    id: string; name: string; slug: string; join_code: string;
    created_at: string; expires_at: string; photo_count: string; total_size_bytes: string;
    is_closed: string; allow_guest_delete: string; view_only: string; find_my_photos: string; organiserPhone: string;
  }>();

  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [extendPickerDate, setExtendPickerDate] = useState<Date>(new Date());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteStep, setDeleteStep] = useState<null | 'password' | 'confirm'>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState<string | null>(null);
  const [deletePasswordLoading, setDeletePasswordLoading] = useState(false);
  const [allowGuestDelete, setAllowGuestDelete] = useState(params.allow_guest_delete === 'true');
  const [viewOnly, setViewOnly] = useState(params.view_only === 'true');
  const [isClosed, setIsClosed] = useState(params.is_closed === 'true');
  const [findMyPhotos, setFindMyPhotos] = useState(params.find_my_photos === 'true');
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [coadmins, setCoadmins] = useState<Coadmin[]>([]);
  const [coadminsLoading, setCoadminsLoading] = useState(true);
  const [addingCoadmin, setAddingCoadmin] = useState(false);
  const [showCoadminPanel, setShowCoadminPanel] = useState(false);
  const [allowedGuests, setAllowedGuests] = useState<AllowedGuest[]>([]);
  const [allowedGuestsLoading, setAllowedGuestsLoading] = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [showGuestsPanel, setShowGuestsPanel] = useState(false);

  const gearRef = useRef<TouchableOpacity>(null);
  const [gearMenuVisible, setGearMenuVisible] = useState(false);
  const [gearDropPos, setGearDropPos] = useState({ top: 0, right: 0 });

  const [organiserDisplayName, setOrganiserDisplayName] = useState<string>('Organiser');

  useEffect(() => {
    getUserProfile().then(p => {
      if (p) setOrganiserDisplayName(`${p.firstName} ${p.lastName}`.trim());
    });
  }, []);

  type JoinedGuest = { name: string; mobile: string; is_blocked: boolean; photo_count?: number; role?: 'organiser' | 'coadmin' | 'user' };
  const [showManageGuestsPanel, setShowManageGuestsPanel] = useState(false);
  const [joinedGuests, setJoinedGuests] = useState<JoinedGuest[]>([]);
  const [joinedGuestsTotalPhotos, setJoinedGuestsTotalPhotos] = useState<number | null>(null);
  const [joinedGuestsLoading, setJoinedGuestsLoading] = useState(false);
  const [joinedGuestsError, setJoinedGuestsError] = useState<string | null>(null);
  const [togglingGuest, setTogglingGuest] = useState<string | null>(null);
  const [guestContactMap, setGuestContactMap] = useState<Record<string, string>>({});

  type PickerContact = { name: string; phones: string[] };
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showCoadminPicker, setShowCoadminPicker] = useState(false);
  // ⭐ Its OWN search state, deliberately not `contactSearch`: sharing it
  // would mean typing in one picker silently filtered the other.
  const [coadminSearch, setCoadminSearch] = useState('');
  const [coadminListSearch, setCoadminListSearch] = useState('');
  const [allowedSearch, setAllowedSearch] = useState('');
  const [joinedSearch, setJoinedSearch] = useState('');
  // ⛔ DEFAULTS TO 'guest' SINCE 2026-10-20. 'coadmin' is no longer
  // displayable — its modals are gone — so starting there would mean a
  // future mistake produced a button that SILENTLY DID NOTHING. In a public
  // app that is the worst failure there is: unreportable and
  // unreproducible. The only reachable value is now the only default.
  const [contactPickerMode, setContactPickerMode] = useState<'coadmin' | 'guest'>('guest');
  const [contactsList, setContactsList] = useState<PickerContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [expandedContact, setExpandedContact] = useState<number | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualInputMode, setManualInputMode] = useState<'coadmin' | 'guest'>('guest');
  const [manualPhone, setManualPhone] = useState('');

  const { requestAppPermission, primingOverlay } = useAppPermission();

  const loadCoadmins = useCallback(async () => {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setCoadminsLoading(true);
    try {
      const result = await listCoadmins(params.slug, params.organiserPhone, pw);
      if (result.coadmins) {
        setCoadmins(result.coadmins);
        try {
          const { status } = await Contacts.getPermissionsAsync();
          if (status === 'granted') {
            const { data: allContacts } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
            const map: Record<string, string> = {};
            for (const ca of result.coadmins) {
              const match = allContacts.find(c =>
                (c.phoneNumbers ?? []).some(pn => normalizeIndianPhone(pn.number ?? '') === ca.phone)
              );
              if (match?.name) map[ca.phone] = match.name;
            }
            setGuestContactMap(prev => ({ ...prev, ...map }));
          }
        } catch {}
      }
    } finally {
      setCoadminsLoading(false);
    }
  }, [params.slug, params.organiserPhone]);

  useEffect(() => { loadCoadmins(); }, [loadCoadmins]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/(master)/dashboard');
      return true;
    });
    return () => sub.remove();
  }, [router]);

  const loadAllowedGuests = useCallback(async () => {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setAllowedGuestsLoading(true);
    try {
      const [allowedResult, joinedResult] = await Promise.all([
        listAllowedGuests(params.slug, params.organiserPhone, pw),
        listJoinedGuestsForUser(params.slug, params.organiserPhone),
      ]);
      if (joinedResult.guests) {
        const organiserName = (await getUserProfile())?.name ?? '';
        const organiserPhone = params.organiserPhone;
        const organiserEntry: JoinedGuest = { name: organiserName, mobile: organiserPhone, is_blocked: false, role: 'organiser' };
        const others = joinedResult.guests.filter(g => g.mobile !== organiserPhone);
        setJoinedGuests([organiserEntry, ...others]);
        setJoinedGuestsTotalPhotos(joinedResult.total_photo_count ?? null);
      }
      if (allowedResult.guests) {
        setAllowedGuests(allowedResult.guests);
        try {
          const { status } = await Contacts.getPermissionsAsync();
          if (status === 'granted') {
            const { data: allContacts } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
            const map: Record<string, string> = {};
            for (const guest of allowedResult.guests) {
              const match = allContacts.find(c =>
                (c.phoneNumbers ?? []).some(pn => normalizeIndianPhone(pn.number ?? '') === guest.phone)
              );
              if (match?.name) map[guest.phone] = match.name;
            }
            setGuestContactMap(prev => ({ ...prev, ...map }));
          }
        } catch {}
      }
    } finally {
      setAllowedGuestsLoading(false);
    }
  }, [params.slug, params.organiserPhone]);

  useEffect(() => { if (isClosed) loadAllowedGuests(); }, [isClosed, loadAllowedGuests]);

  const loadJoinedGuests = useCallback(async () => {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setJoinedGuestsLoading(true);
    setJoinedGuestsError(null);
    try {
      const result = await listJoinedGuestsForUser(params.slug, params.organiserPhone);
      if (result.guests) {
        // Pin organiser to top of the list, even if they haven't joined
        const organiserPhone = params.organiserPhone!;
        const profile = await getUserProfile();
        const organiserName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'Organiser';
        setOrganiserDisplayName(organiserName);
        const others = result.guests.filter(g => g.mobile !== organiserPhone);
        const organiserFromApi = result.guests.find(g => g.mobile === organiserPhone);
        const organiserEntry: JoinedGuest = { name: organiserName, mobile: organiserPhone, is_blocked: false, photo_count: organiserFromApi?.photo_count ?? 0, role: 'organiser' };
        setJoinedGuests([organiserEntry, ...others]);
        setJoinedGuestsTotalPhotos(result.total_photo_count ?? null);
        // Look up each mobile in the organiser's contacts
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
            setGuestContactMap(prev => ({ ...prev, ...map }));
          }
        } catch {}
      } else {
        setJoinedGuestsError(result.error ?? 'Could not load guests.');
      }
    } catch {
      setJoinedGuestsError('Network error. Please try again.');
    } finally {
      setJoinedGuestsLoading(false);
    }
  }, [params.slug, params.organiserPhone]);

  async function handleToggleBlock(mobile: string, currentlyBlocked: boolean) {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setTogglingGuest(mobile);
    const result = await setGuestBlocked(params.slug, mobile, !currentlyBlocked, params.organiserPhone, pw);
    setTogglingGuest(null);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setJoinedGuests(prev => prev.map(g => g.mobile === mobile ? { ...g, is_blocked: !currentlyBlocked } : g));
    }
  }

  async function handleToggleGuestDelete(value: boolean) {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setSettingsUpdating(true);
    const result = await updateEventSettings(params.slug, params.organiserPhone, pw, { allowGuestDelete: value });
    setSettingsUpdating(false);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setAllowGuestDelete(value);
    }
  }

  // ⛔ handleToggleViewOnly WAS REMOVED HERE on 2026-10-20. View-only is
  // chosen when the event is created and can never change, so there is
  // nothing to toggle. The settings route refuses the field outright.

  async function handleToggleFindMyPhotos(value: boolean) {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setSettingsUpdating(true);
    const result = await updateEventSettings(params.slug, params.organiserPhone, pw, { findMyPhotosEnabled: value });
    setSettingsUpdating(false);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setFindMyPhotos(value);
    }
  }

  // ⛔⛔ handleToggleIsClosed WAS REMOVED HERE on 2026-10-20, and with it the
  // "Close this event? → Remove all guests?" chain and the reopen branch.
  //
  // THE USER'S REASON, in their words: *"a Organiser makes an open event -
  // then after 2 days makes it private and removes everyone - its not fair to
  // the users."* The purge deleted every joined record with no undo, which
  // ALSO deleted a co-admin's record and so made them invisible in Manage
  // Guests and impossible to block. Freezing the setting removes the whole
  // class rather than patching it.
  //
  // The reopen branch is gone for the same reason: it deleted the entire
  // allowed-guest list, and `is_closed` can no longer change.
  // ✅ The purge is now gone end to end (2026-10-21): the backend DELETE
  // handler and `clearJoinedGuests` in lib/api were both removed after a
  // front-end sweep of both repos found no callers. It also held the last
  // unsafe `owner_phone &&` guard, which skipped the ownership check for an
  // event with a NULL owner.

  function copyCode() {
    const text = `You're invited to ${params.name}!\n\nEvent Code: ${params.join_code}\nJoin here: https://momentsinframe.com/join/${params.join_code}`;
    Clipboard.setString(text);
    showAlert('Copied!', text);
  }

  async function handleExtend() {
    const current = params.expires_at ? new Date(params.expires_at) : new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pickerDate = current > tomorrow ? current : tomorrow;
    if (Platform.OS === 'ios') {
      setExtendPickerDate(pickerDate);
      setShowExtendPicker(true);
    } else {
      DateTimePickerAndroid.open({
        value: pickerDate,
        mode: 'date',
        minimumDate: today,
        onChange: async (event, date) => {
          if (event.type !== 'set' || !date) return;
          const iso = date.toISOString().split('T')[0];
          const profile = await getUserProfile();
          const pw = await getOrganiserPassword();
          if (!profile || !pw) return;
          const result = await extendEvent(params.slug, profile.mobile, pw, iso);
          if (result.error) {
            showAlert('Error', result.error);
          } else {
            showAlert('Done', 'Expiry date updated.', [{ text: 'OK', onPress: () => router.back() }]);
          }
        },
      });
    }
  }

  async function confirmExtendIos() {
    setShowExtendPicker(false);
    const iso = extendPickerDate.toISOString().split('T')[0];
    const profile = await getUserProfile();
    const pw = await getOrganiserPassword();
    if (!profile || !pw) return;
    const result = await extendEvent(params.slug, profile.mobile, pw, iso);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      showAlert('Done', 'Expiry date updated.', [{ text: 'OK', onPress: () => router.back() }]);
    }
  }

  function handleDelete() {
    setDeletePassword('');
    setDeletePasswordError(null);
    setDeleteStep('password');
  }

  async function handleDeletePasswordSubmit() {
    const profile = await getUserProfile();
    if (!profile) return;
    setDeletePasswordLoading(true);
    setDeletePasswordError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/native/organiser/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: profile.mobile, password: deletePassword.trim() }),
      });
      const data = await res.json();
      if (!data.success) { setDeletePasswordError('Incorrect password.'); return; }
      setDeleteStep('confirm');
    } catch { setDeletePasswordError('Could not verify. Try again.'); }
    finally { setDeletePasswordLoading(false); }
  }

  async function handleDeleteConfirm() {
    const profile = await getUserProfile();
    const pw = await getOrganiserPassword();
    if (!profile || !pw) return;
    setDeleteLoading(true);
    const result = await deleteEvent(params.slug, profile.mobile, pw);
    setDeleteLoading(false);
    setDeleteStep(null);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      router.replace('/(master)/dashboard');
    }
  }

  function normalizeIndianPhone(raw: string): string {
    let n = raw.replace(/\D/g, '');
    if (n.startsWith('0091')) n = n.slice(4);
    else if (n.startsWith('91') && n.length === 12) n = n.slice(2);
    else if (n.startsWith('0') && n.length === 11) n = n.slice(1);
    return n;
  }

  function isIndianMobile(n: string): boolean {
    return n.length === 10 && /^[6-9]/.test(n);
  }

  async function loadContactsForPicker(mode: 'coadmin' | 'guest') {
    const permResult = await Contacts.requestPermissionsAsync();
    if (!permResult.granted) {
      if (shouldShowDeniedAlert(permResult.granted, permResult.canAskAgain)) {
        showPermissionDeniedAlert('Contacts');
      }
      return;
    }
    const { data: contacts } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
    });
    const processed: PickerContact[] = contacts
      .map(c => {
        const seen = new Set<string>();
        const phones = (c.phoneNumbers ?? [])
          .map(pn => normalizeIndianPhone(pn.number ?? ''))
          .filter(n => isIndianMobile(n) && !seen.has(n) && seen.add(n));
        return { name: c.name ?? '', phones };
      })
      .filter(c => c.phones.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (processed.length === 0) {
      showAlert('No contacts', 'No contacts with mobile numbers found.');
      return;
    }
    setContactsList(processed);
    setContactSearch('');
    setExpandedContact(null);
    setContactPickerMode(mode);
    setShowContactPicker(true);
  }

  // ⛔ THE CONTACT PICKER IS GUESTS-ONLY NOW. Co-admins are chosen from the
  // people who have joined, so the 'coadmin' branch here could never run and
  // was removed on 2026-10-20 with the two modals it fed.
  function handlePickerSelect(phone: string, name: string) {
    setShowContactPicker(false);
    confirmAddGuest(phone, name);
  }

  // ⛔ A CO-ADMIN IS CHOSEN FROM THE PEOPLE WHO HAVE ALREADY JOINED —
  // 2026-10-20, the user's decision. It used to offer contacts or a typed
  // number, which could give full co-admin powers to someone with no
  // `event_users` row: they never appeared in Manage Guests, so they could
  // never be blocked. Picking from joined guests makes "everyone with access
  // is visible and blockable" true by construction. The backend refuses a
  // non-member too, so a stale build cannot get round it.
  async function handleAddCoadmin() {
    // ⚠ Clear the search EVERY time. A leftover term from last time would
    // show an empty list and read as "this is broken".
    setCoadminSearch('');
    setShowCoadminPicker(true);
    await loadJoinedGuests();
  }

  async function confirmAddCoadmin(phone: string, name: string | null) {
    if (phone === params.organiserPhone) {
      showAlert('Not allowed', 'You cannot add yourself as an Admin.');
      return;
    }
    if (coadmins.some(c => c.phone === phone)) {
      showAlert('Already added', `${name ?? phone} is already an Admin.`);
      return;
    }
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    const result = await addCoadmin(params.slug, params.organiserPhone, pw, phone, name);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      await loadCoadmins();
    }
  }

  async function handleAddGuest() {
    showAlert(
      'Add Guest',
      'How would you like to add a guest?',
      [
        { text: 'From contacts', onPress: () => loadContactsForPicker('guest') },
        { text: 'Enter number manually', onPress: () => { setManualInputMode('guest'); setManualPhone(''); setShowManualInput(true); } },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function confirmAddGuest(phone: string, name?: string) {
    if (phone === params.organiserPhone) {
      showAlert('Already in event', 'You are the Organiser of this event and always have access.');
      return;
    }
    const displayName = name ?? phone;
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    // Fetch fresh joined guests to get reliable blocked status
    const freshJoined = await listJoinedGuestsForUser(params.slug, params.organiserPhone);
    const freshJoinedList = freshJoined.guests ?? [];
    const alreadyInList = allowedGuests.some(g => g.phone === phone);
    const blockedEntry = freshJoinedList.find(g => g.mobile === phone && g.is_blocked);
    if (alreadyInList) {
      if (blockedEntry) {
        showAlert('Already in list', `${displayName} is already in the list but is currently blocked. Tap Unblock next to their name.`);
      } else {
        showAlert('Already added', `${displayName} is already in the allowed guests list.`);
      }
      return;
    }
    if (blockedEntry) {
      showAlert(
        'Guest is blocked',
        `${displayName} is currently blocked. Adding them will also unblock them.`,
        [
          {
            text: 'Unblock & Add',
            onPress: async () => {
              await Promise.all([
                addAllowedGuests(params.slug, params.organiserPhone!, pw, [{ phone, name }]),
                setGuestBlocked(params.slug, phone, false, params.organiserPhone!, pw),
              ]);
              setJoinedGuests(prev => prev.map(g => g.mobile === phone ? { ...g, is_blocked: false } : g));
              await loadAllowedGuests();
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    const result = await addAllowedGuests(params.slug, params.organiserPhone, pw, [{ phone, name }]);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      await loadAllowedGuests();
    }
  }

  async function handleRemoveGuest(phone: string, name: string | null) {
    showAlert(
      `Remove ${name ?? phone}?`,
      'They will no longer be able to access this event.',
      [
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const pw = await getOrganiserPassword();
            if (!pw || !params.organiserPhone) return;
            const result = await removeAllowedGuest(params.slug, params.organiserPhone, pw, phone);
            if (result.error) {
              showAlert('Error', result.error);
            } else {
              await loadAllowedGuests();
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function handleRemoveCoadmin(phone: string, name: string | null) {
    showAlert(
      `Remove ${name ?? phone}?`,
      'They will no longer have Admin access to this event.',
      [
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const pw = await getOrganiserPassword();
            if (!pw || !params.organiserPhone) return;
            const result = await removeCoadmin(params.slug, params.organiserPhone, pw, phone);
            if (result.error) {
              showAlert('Error', result.error);
            } else {
              await loadCoadmins();
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ⚠ Filtered COPIES only. The real lists keep their own lengths, because
  // the layout switches on how many guests there ARE, not how many match a
  // search — filtering to one result must not flip a 300-guest event into the
  // "single guest" layout.
  const shownCoadmins = coadmins.filter(ca =>
    matchesPersonSearch(coadminListSearch, ca.phone, guestContactMap[ca.phone], ca.appName, ca.name));
  const shownAllowed = allowedGuests.filter(g =>
    matchesPersonSearch(allowedSearch, g.phone, guestContactMap[g.phone], g.appName, (g as { name?: string }).name));
  const blockedNotAllowed = joinedGuests.filter(jg =>
    jg.is_blocked && jg.mobile !== params.organiserPhone && !allowedGuests.some(ag => ag.phone === jg.mobile));
  const shownBlockedNotAllowed = blockedNotAllowed.filter(jg =>
    matchesPersonSearch(allowedSearch, jg.mobile, guestContactMap[jg.mobile], jg.name));
  const shownJoined = joinedGuests.filter(g =>
    matchesPersonSearch(joinedSearch, g.mobile, guestContactMap[g.mobile], g.name));

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Manage Event</Text>
          <TouchableOpacity
            ref={gearRef}
            style={styles.headerGear}
            onPress={() => {
              gearRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
                setGearDropPos({ top: pageY + height + 4, right: Dimensions.get('window').width - pageX - width });
                setGearMenuVisible(true);
              });
            }}
          >
            <Text style={styles.headerGearIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.eventName}>{params.name}</Text>
        <Text style={[styles.eventSub, { marginBottom: 4 }]}>Created: {formatDate(params.created_at)} · Expires: {formatDate(params.expires_at)}</Text>
        <Text style={styles.eventSub}>
          {params.photo_count} photos · {formatStorage(parseInt(params.total_size_bytes ?? '0', 10))} · Event Code: <Text style={styles.codeHighlight}>{params.join_code}</Text>
        </Text>

        <Text style={styles.sectionLabel}>SHARE</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={copyCode}>
            <Text style={styles.btnText}>Event Code</Text>
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

        <Text style={styles.sectionLabel}>ACTIONS</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={handleExtend}>
            <Text style={styles.btnText}>Extend expiry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { borderColor: Colors.accent }]} // ⚠ `loadJoinedGuests` is needed for the BLOCKED badge on each row:
            // blocking lives in `event_users`, which the co-admin list does
            // not carry. Without it the panel renders before the status is
            // known and no badge appears.
            onPress={() => requestAppPermission('contacts', () => { loadCoadmins(); loadJoinedGuests(); setShowCoadminPanel(true); }, params.organiserPhone)}>
            <Text style={[styles.btnText, { color: Colors.accent }]}>+ Admins</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>SETTINGS</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Allow guests to delete photos</Text>
            <Text style={styles.settingDesc}>{allowGuestDelete && !viewOnly ? 'Guests can delete their own uploaded photos' : 'Guests cannot delete photos'}</Text>
          </View>
          {settingsUpdating
            ? <ActivityIndicator color={Colors.accent} />
            : <Switch
                value={viewOnly ? false : allowGuestDelete}
                onValueChange={viewOnly ? undefined : handleToggleGuestDelete}
                disabled={viewOnly}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
          }
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Invite only event</Text>
            <Text style={styles.settingDesc}>
              {isClosed ? 'Only guests on the allowed list can join' : 'Anyone with the event code can join'}
            </Text>
            <Text style={styles.settingLocked}>Chosen when the event was created</Text>
            {isClosed && (
              <TouchableOpacity onPress={() => requestAppPermission('contacts', () => { loadAllowedGuests(); setShowGuestsPanel(true); }, params.organiserPhone)}>
                <Text style={styles.manageGuestsInline}>
                  Allowed Guests{allowedGuests.length > 0 ? ` (${allowedGuests.length})` : ''} →
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* ⛔ Frozen. Shown, not hidden: the organiser must still be able to
              see what kind of event this is, and a hidden control reads as a
              missing feature to the next person who opens this file. */}
          <Switch
            value={isClosed}
            disabled
            trackColor={{ false: '#333', true: Colors.accent }}
            thumbColor={Colors.white}
          />
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>View only event</Text>
            {/* ⚠ This line used to be STATIC — it read "Guests can only view and
                download photos" even when the setting was OFF, describing a
                state that was not active. Fixed 2026-10-20. */}
            <Text style={styles.settingDesc}>
              {viewOnly ? 'Guests can only view and download photos' : 'Guests can upload, view and download photos'}
            </Text>
            <Text style={styles.settingLocked}>Chosen when the event was created</Text>
          </View>
          <Switch
            value={viewOnly}
            disabled
            trackColor={{ false: '#333', true: Colors.accent }}
            thumbColor={Colors.white}
          />
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>My Photos</Text>
            <Text style={styles.settingDesc}>{findMyPhotos ? 'Guests can find photos of themselves using a selfie' : 'My Photos is disabled for this event'}</Text>
          </View>
          {settingsUpdating
            ? <ActivityIndicator color={Colors.accent} />
            : <Switch
                value={findMyPhotos}
                onValueChange={handleToggleFindMyPhotos}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
          }
        </View>

        <View style={styles.divider} />

        <View style={styles.bottomBtnRow}>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Delete Event</Text>
        </TouchableOpacity>
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
              adminPhone: params.organiserPhone ?? '',
              allowGuestDelete: allowGuestDelete ? 'true' : 'false',
              viewOnly: viewOnly ? 'true' : 'false',
              role: 'organiser',
              joinCode: params.join_code,
              ownerPhone: params.organiserPhone ?? '',
            },
          })}
        >
          <Text style={styles.openBtnText}>Open Event</Text>
        </TouchableOpacity>
        </View>
      </ScrollView>

      {deleteLoading && (
        <Modal transparent animationType="fade">
          <View style={styles.deletingOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.deletingText}>Deleting event...</Text>
          </View>
        </Modal>
      )}

      {/* Delete Step 1: Password */}
      <Modal visible={deleteStep === 'password'} transparent animationType="fade" onRequestClose={() => setDeleteStep(null)}>
        <View style={styles.deletingOverlay}>
          <View style={styles.deleteModal}>
            <Text style={styles.deleteModalTitle}>Verify your password</Text>
            <Text style={styles.deleteModalWarning}>
              This action <Text style={{ color: '#E53935', fontWeight: '700' }}>cannot be undone</Text>. All photos in this event will be permanently deleted.
            </Text>
            <TextInput
              placeholder="Enter your password"
              placeholderTextColor="#555"
              secureTextEntry
              value={deletePassword}
              onChangeText={setDeletePassword}
              autoCapitalize="none"
              style={styles.deletePasswordInput}
            />
            {deletePasswordError && <Text style={styles.deletePasswordError}>{deletePasswordError}</Text>}
            <View style={styles.deleteModalButtons}>
              <TouchableOpacity style={styles.deleteModalCancel} onPress={() => setDeleteStep(null)}>
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteModalConfirm, (!deletePassword.trim() || deletePasswordLoading) && { opacity: 0.5 }]}
                onPress={handleDeletePasswordSubmit}
                disabled={!deletePassword.trim() || deletePasswordLoading}
              >
                <Text style={styles.deleteModalConfirmText}>{deletePasswordLoading ? 'Verifying…' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Step 2: Final Confirm */}
      <Modal visible={deleteStep === 'confirm'} transparent animationType="fade" onRequestClose={() => setDeleteStep(null)}>
        <View style={styles.deletingOverlay}>
          <View style={styles.deleteModal}>
            <Text style={[styles.deleteModalTitle, { color: '#E53935' }]}>Delete "{params.name}"?</Text>
            <Text style={styles.deleteModalWarning}>
              You are about to permanently delete this event and all its photos. There is no way to recover them.
            </Text>
            <View style={styles.deleteModalButtons}>
              <TouchableOpacity style={styles.deleteModalCancel} onPress={() => setDeleteStep(null)}>
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteModalConfirm} onPress={handleDeleteConfirm}>
                <Text style={styles.deleteModalConfirmText}>Yes, Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Co-Admin Panel */}
      {/* ⛔ MOUNTED ONLY WHILE OPEN — `{flag && <Modal visible>}`, NOT
          `<Modal visible={flag}>`. This is not a style preference.
          Until 2026-10-21 this panel was always mounted, and it was the ONLY
          panel in the file that kept a HIDDEN MODAL MOUNTED INSIDE ANOTHER
          MODAL'S TREE (the Add Co-Admin picker below). Its search box then
          rendered its placeholder stretched across the full width and
          clipped — "S e a r c h   b y   n a m e   o r   n u" — while the
          identical SearchBox rendered correctly everywhere else.
          ⭐ THE EVIDENCE, because the cause is not guessable from one screen:
            · Manage Guests  — always mounted, NO nested modal  → fine
            · Allowed Guests — conditionally mounted, 2 nested  → fine
            · Co-Admins      — always mounted, nested modal     → BROKEN
          Only the combination breaks, so neither nesting alone nor
          always-mounting alone is the cause.
          ⭐ Allowed Guests has had this exact shape since `7cd6d5c`
          (13 July), in a commit titled "...contact picker safe area fix" —
          the same family of iOS problem as
          [[feedback-ios-modal-safe-area]]: a Modal makes a new root view on
          iOS and context does not propagate into it cleanly.
          ⚠ THE NESTING ITSELF MUST STAY. React Native will not present a
          Modal over an already-open SIBLING modal; that was the 2026-10-20
          bug ("nothing happens until I close the Co-admins panel"). This
          changes WHEN the modal exists, never WHERE it sits. */}
      {showCoadminPanel && (
      <Modal visible animationType="slide" onRequestClose={() => setShowCoadminPanel(false)}>
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Admins{coadmins.length > 0 ? ` (${coadmins.length})` : ''}</Text>
            <TouchableOpacity onPress={() => setShowCoadminPanel(false)}>
              <Text style={styles.panelClose}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.panelDesc}>Admins can delete any photo uploaded by any guest or other Admins but not photos by the Organiser. They join using the event code, just like other guests.</Text>
          <SearchBox value={coadminListSearch} onChange={setCoadminListSearch} />
          <ScrollView contentContainerStyle={styles.panelScroll}>
            {coadminsLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
            ) : coadmins.length === 0 ? (
              <Text style={styles.emptyText}>No Admins added yet.</Text>
            ) : shownCoadmins.length === 0 ? (
              <Text style={styles.emptyText}>No one matches that search.</Text>
            ) : (
              shownCoadmins.map(ca => {
                const contactName = guestContactMap[ca.phone];
                const appName = ca.appName ?? null;
                const displayName = contactName || appName || ca.name || ca.phone;
                const subName = contactName && appName && appName !== contactName ? appName : null;
                // ⛔ BLOCKED STATUS COMES FROM `joinedGuests`, NOT FROM THE
                // CO-ADMIN LIST. `event_coadmins` has no `is_blocked` column —
                // blocking lives in `event_users` — so this panel could not tell
                // an active co-admin from a blocked one, and showed a plain row
                // with a Remove button either way. The user spotted it on device
                // (2026-10-21) while a blocked co-admin was on screen.
                // ⚠ Cross-referencing here keeps it an APP-ONLY fix: no backend
                // change, so no deploy had to be coordinated with this OTA.
                // ⚠ It needs `loadJoinedGuests()` to have run — it is now called
                // when this panel opens, beside `loadCoadmins()`.
                // ⚠ Absent from `joinedGuests` means UNKNOWN, so no badge: an old
                // co-admin promoted before joining was required has no
                // `event_users` row at all. Failing to "not blocked" is right —
                // a false BLOCKED would be worse than a missing one.
                const blocked = joinedGuests.some(g => g.mobile === ca.phone && g.is_blocked);
                return (
                  <View key={ca.phone} style={styles.coadminRow}>
                    <View style={styles.coadminInfo}>
                      <Text style={[styles.coadminName, blocked && styles.blockedText]}>{displayName}</Text>
                      {subName ? <Text style={[styles.coadminPhone, blocked && styles.blockedText]}>{subName}</Text> : null}
                      {/* Same shape as Manage Guests and the picker: the badge
                          follows the NUMBER. */}
                      <View style={styles.pickerPhoneLine}>
                        <Text style={[styles.coadminPhone, blocked && styles.blockedText]}>{ca.phone}</Text>
                        {blocked && <Text style={[styles.blockedBadge, { marginLeft: 6 }]}>· BLOCKED</Text>}
                      </View>
                    </View>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveCoadmin(ca.phone, ca.name)}>
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
            <TouchableOpacity
              style={[styles.btn, { marginTop: 12, borderColor: Colors.accent, opacity: addingCoadmin ? 0.5 : 1 }]}
              onPress={handleAddCoadmin}
              disabled={addingCoadmin}
            >
              {addingCoadmin
                ? <ActivityIndicator color={Colors.accent} />
                : <Text style={[styles.btnText, { color: Colors.accent }]}>Add Admin</Text>
              }
            </TouchableOpacity>
          </ScrollView>
          {/* Manual Input — inside co-admin panel so it renders on top */}
          {/* ⛔ TWO MODALS WERE REMOVED HERE on 2026-10-20: the co-admin
              "Enter number manually" dialog and the co-admin contact picker.
              Both became unreachable when Add Co-Admin started choosing from
              the people who have JOINED — nothing set their mode to 'coadmin'
              any more, so neither could ever render. Verified by grep: zero
              call sites. The GUEST versions of both are alive and well in the
              Allowed Guests panel; only the co-admin twins went. */}

          {/* Co-Admin picker — only people who have actually joined.
              ⛔ IT MUST LIVE INSIDE THIS PANEL'S OWN MODAL, NOT BESIDE IT.
              React Native will not present a Modal over an already-open
              SIBLING Modal: it mounts underneath and appears only once the
              first is dismissed. Shipped that way on 2026-10-20 and the
              user found it immediately — "nothing happens until I close the
              Co-admins panel". The two modals above are nested for the same
              reason; the convention was already here. ⚠ No typecheck, hook
              check or string audit can see this. */}
          {/* ⚠ Conditionally mounted for the same reason as the panel above:
              a hidden Modal left mounted inside another Modal's tree is what
              broke the panel's search box. Still NESTED, which is what keeps
              it presenting over the panel rather than underneath it. */}
          {showCoadminPicker && (
          <Modal visible animationType="slide" onRequestClose={() => setShowCoadminPicker(false)}>
            <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Add Admin</Text>
                <TouchableOpacity onPress={() => setShowCoadminPicker(false)}>
                  <Text style={styles.panelClose}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.panelDesc}>Choose someone who has already joined this event. An Admin can manage photos, so they must be in the event first.</Text>
          {/* ⭐ SEARCH IS NOT OPTIONAL AT SCALE. With one test guest a plain
                  list looks fine; at a 300-guest wedding an organiser would scroll
                  300 names to find one person — and the contact picker this
                  replaced already had search. It searches ONLY the people who have
                  joined this event. */}
              <View style={styles.pickerSearchWrap}>
                <TextInput
                  style={styles.pickerSearch}
                  value={coadminSearch}
                  onChangeText={setCoadminSearch}
                  placeholder="Search by name or number"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
              </View>
              <ScrollView contentContainerStyle={styles.panelScroll}>
                {joinedGuestsLoading ? (
                  <ActivityIndicator color={Colors.accent} style={{ marginTop: 24 }} />
                ) : (() => {
                  // ⛔ EVERYONE WHO JOINED IS LISTED, MINUS THE ORGANISER.
                  // Status is SHOWN with a badge, never filtered out — see the
                  // rows below. Until 2026-10-21 this also dropped co-admins
                  // (`role === 'user'`) and blocked guests, and that was wrong
                  // in two ways the user found on device:
                  //   1. Searching an existing co-admin by name said "No one
                  //      matches that search" — which reads as "they are not in
                  //      this event" about someone who is, and is already a
                  //      co-admin. At 300 guests the organiser SEARCHES rather
                  //      than scrolls, so that lie is all they ever see.
                  //   2. Add the only joined guest as a co-admin and the list
                  //      emptied, firing "Guests need to join the event" at an
                  //      organiser whose guest HAD joined. Blocked guests did
                  //      the same.
                  // ⭐ Listing everyone does not just fix the message, it makes
                  // the whole class impossible: if nobody is hidden, the ONLY
                  // way this list can be empty is that nobody joined — so the
                  // empty state below is true again, always, and no third
                  // message is ever needed.
                  const eligible = joinedGuests.filter(g => g.mobile !== params.organiserPhone);
                  const q = coadminSearch.trim().toLowerCase();
                  // Matches anything shown in the row: the name they registered
                  // with, the name in YOUR contacts, and the number. Typing what
                  // you can see on screen must find it.
                  const shown = q
                    ? eligible.filter(g =>
                        (g.name ?? '').toLowerCase().includes(q)
                        || (guestContactMap[g.mobile] ?? '').toLowerCase().includes(q)
                        || g.mobile.includes(q))
                    : eligible;
                  // ⭐ Now unambiguous: nothing is filtered, so an empty list
                  // can ONLY mean nobody has joined. This sentence was false
                  // twice before (see above).
                  if (eligible.length === 0) {
                    return <Text style={styles.panelEmpty}>Nobody is available. Guests need to join the event before they can be made an Admin.</Text>;
                  }
              // ⛔ A SECOND, DIFFERENT EMPTY STATE. Without it, searching a name
                  // that is not there would say "guests need to join" — which is
                  // FALSE, since they have joined, and sends the organiser to fix
                  // the wrong thing.
                  if (shown.length === 0) {
                    return <Text style={styles.panelEmpty}>No one matches that search.</Text>;
                  }
                  return shown.map(g => {
                    // Only a plain, unblocked guest can be promoted. Everyone
                    // else stays visible and carries the badge that says why.
                    const pickable = g.role === 'user' && !g.is_blocked;
                    return (
                    <TouchableOpacity
                      key={g.mobile}
                      style={styles.pickerContact}
                      disabled={!pickable}
                      // ⚠ No press highlight on a row that does nothing, and no
                      // alert on tap either: the badge already says why, and a
                      // popup repeating it is noise.
                      activeOpacity={pickable ? 0.2 : 1}
                      onPress={() => { setShowCoadminPicker(false); confirmAddCoadmin(g.mobile, g.name); }}
                    >
                      <View style={styles.pickerBadgeRow}>
                        {/* ⭐ THE SAME THREE LINES AS MANAGE GUESTS, IN THE SAME
                            ORDER, DIMMED THE SAME WAY, WITH "· BLOCKED" IN THE
                            SAME PLACE — after the NUMBER on the third line, not
                            off to the right. The two screens sit next to each
                            other and must not describe the same person
                            differently. The user compared them side by side on
                            device (2026-10-21) and the badge was in the wrong
                            place here.
                            ⚠ DIMMING MEANS EXACTLY ONE THING: BLOCKED. It briefly
                            meant "cannot be picked" here, so a co-admin looked
                            dimmed too — which reads as "blocked" on the screen
                            next door. A co-admin now renders at full strength and
                            the badge alone says why the row does nothing. */}
                        <View style={styles.pickerBadgeText}>
                          <Text style={[styles.pickerName, g.is_blocked && styles.blockedText]}>{g.name || g.mobile}</Text>
                          <Text style={[styles.pickerPhone, g.is_blocked && styles.blockedText]}>{guestContactMap[g.mobile] || 'Number not in contacts'}</Text>
                          <View style={styles.pickerPhoneLine}>
                            <Text style={[styles.pickerPhone, g.is_blocked && styles.blockedText]}>{g.mobile}</Text>
                            {g.is_blocked && <Text style={[styles.blockedBadge, { marginLeft: 6 }]}>· BLOCKED</Text>}
                          </View>
                        </View>
                        {/* ⭐ A blocked co-admin shows BOTH markers — the badge here
                            and "· BLOCKED" on the number line — because either one
                            alone hides half the reason they cannot be picked.
                            Blocking a co-admin became possible in 5823500. */}
                        {g.role === 'coadmin' && <Text style={styles.coadminBadge}>Admin</Text>}
                      </View>
                    </TouchableOpacity>
                    );
                  });
                })()}
              </ScrollView>
              {alertOverlay}
            </View>
          </Modal>
          )}

          {alertOverlay}
        </View>
      </Modal>
      )}

      {/* Allowed Guests Panel */}
      {showGuestsPanel && (
        <Modal visible animationType="slide" onRequestClose={() => setShowGuestsPanel(false)}>
          <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Allowed Guests{allowedGuests.length > 0 ? ` (${allowedGuests.length})` : ''}</Text>
              <TouchableOpacity onPress={() => setShowGuestsPanel(false)}>
                <Text style={styles.panelClose}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.panelDesc}>Only guests on this list can join the event. Add guests by their phone number and they'll be able to enter the event code and join.</Text>
            <SearchBox value={allowedSearch} onChange={setAllowedSearch} />
            <ScrollView contentContainerStyle={styles.panelScroll}>
              {allowedGuestsLoading ? (
                <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
              ) : (
                <>
                  {/* Organiser always pinned first, no Remove button */}
                  <View style={styles.coadminRow}>
                    <View style={styles.coadminInfo}>
                      <Text style={styles.coadminName}>{organiserDisplayName}</Text>
                      <Text style={styles.coadminPhone}>{params.organiserPhone}</Text>
                    </View>
                  </View>
                  {allowedGuests.length === 0
                    ? <Text style={[styles.emptyText, { marginTop: 12 }]}>No guests added yet. Add guests to let them in.</Text>
                    : shownAllowed.length === 0 && shownBlockedNotAllowed.length === 0
                    ? <Text style={[styles.emptyText, { marginTop: 12 }]}>No one matches that search.</Text>
                    : shownAllowed.map(g => {
                        const appName = g.appName ?? null;
                        const contactName = guestContactMap[g.phone] ?? null;
                        return (
                          <View key={g.phone} style={styles.coadminRow}>
                            <View style={styles.coadminInfo}>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={styles.coadminName}>{contactName || appName || g.phone}</Text>
                                <Text style={[styles.coadminPhone, { marginLeft: 6 }]}>· {g.photo_count ?? 0} photos</Text>
                              </View>
                              {contactName && appName && appName !== contactName ? <Text style={styles.coadminPhone}>{appName}</Text> : null}
                              {(contactName || appName) ? <Text style={styles.coadminPhone}>{g.phone}</Text> : null}
                            </View>
                            <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveGuest(g.phone, g.name)}>
                              <Text style={styles.removeBtnText}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })
                  }
                  {/* Blocked guests not in allowed list */}
                  {shownBlockedNotAllowed
                    .map(jg => {
                      const contactName = guestContactMap[jg.mobile] ?? null;
                      return (
                        <View key={jg.mobile} style={styles.coadminRow}>
                          <View style={styles.coadminInfo}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={styles.coadminName}>{jg.name || jg.mobile}</Text>
                              <Text style={[styles.coadminPhone, { marginLeft: 6 }]}>· {jg.photo_count ?? 0} photos</Text>
                            </View>
                            <Text style={styles.coadminPhone}>{contactName || 'Number not in contacts'}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={styles.coadminPhone}>{jg.mobile}</Text>
                              <Text style={[styles.blockedBadge, { marginLeft: 6 }]}>· BLOCKED</Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={[styles.removeBtn, { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.5)' }]}
                            onPress={async () => {
                              const pw = await getOrganiserPassword();
                              if (!pw || !params.organiserPhone) return;
                              showAlert(
                                'Unblock & Add?',
                                `${contactName || jg.name || jg.mobile} is currently blocked. Adding them will also unblock them.`,
                                [
                                  {
                                    text: 'Unblock & Add',
                                    onPress: async () => {
                                      await Promise.all([
                                        addAllowedGuests(params.slug, params.organiserPhone!, pw, [{ phone: jg.mobile, name: jg.name ?? undefined }]),
                                        setGuestBlocked(params.slug, jg.mobile, false, params.organiserPhone!, pw),
                                      ]);
                                      setJoinedGuests(prev => prev.map(g => g.mobile === jg.mobile ? { ...g, is_blocked: false } : g));
                                      await loadAllowedGuests();
                                    },
                                  },
                                  { text: 'Cancel', style: 'cancel' },
                                ]
                              );
                            }}
                          >
                            <Text style={[styles.removeBtnText, { color: '#22c55e' }]}>Unblock & Add</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  }
                </>
              )}
              <TouchableOpacity
                style={[styles.btn, { marginTop: 12, borderColor: Colors.accent, opacity: addingGuest ? 0.5 : 1 }]}
                onPress={handleAddGuest}
                disabled={addingGuest}
              >
                {addingGuest
                  ? <ActivityIndicator color={Colors.accent} />
                  : <Text style={[styles.btnText, { color: Colors.accent }]}>+ Add Guest</Text>
                }
              </TouchableOpacity>
            </ScrollView>
            <Modal visible={showManualInput && manualInputMode === 'guest'} animationType="fade" transparent onRequestClose={() => setShowManualInput(false)}>
              <View style={styles.manualOverlay}>
                <View style={styles.manualCard}>
                  <Text style={styles.manualTitle}>Enter phone number</Text>
                  <TextInput
                    style={styles.manualInput}
                    value={manualPhone}
                    onChangeText={setManualPhone}
                    keyboardType="phone-pad"
                    placeholder="e.g. 9876543210"
                    placeholderTextColor="#555"
                    autoFocus
                  />
                  <View style={styles.manualBtns}>
                    <TouchableOpacity style={styles.manualCancel} onPress={() => setShowManualInput(false)}>
                      <Text style={styles.manualCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.manualAdd, !manualPhone.trim() && { opacity: 0.4 }]}
                      disabled={!manualPhone.trim()}
                      onPress={async () => {
                        const clean = normalizeIndianPhone(manualPhone);
                        if (!isIndianMobile(clean)) {
                          showAlert('Invalid number', 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).');
                          return;
                        }
                        setShowManualInput(false);
                        let name: string | undefined = contactsList.find(c => c.phones.includes(clean))?.name;
                        if (!name) {
                          try {
                            const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
                            const match = data.find(c => (c.phoneNumbers ?? []).some(pn => normalizeIndianPhone(pn.number ?? '') === clean));
                            if (match?.name) name = match.name;
                          } catch {}
                        }
                        confirmAddGuest(clean, name);
                      }}
                    >
                      <Text style={styles.manualAddText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {alertOverlay}
              </View>
            </Modal>
            {/* Contact Picker — nested inside guest modal so iOS can stack it */}
            <Modal visible={showContactPicker && contactPickerMode === 'guest'} animationType="slide" onRequestClose={() => setShowContactPicker(false)}>
              <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>Select Contact</Text>
                  <TouchableOpacity onPress={() => setShowContactPicker(false)}>
                    <Text style={styles.panelClose}>×</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.pickerSearchWrap}>
                  <TextInput
                    style={styles.pickerSearch}
                    value={contactSearch}
                    onChangeText={t => { setContactSearch(t); setExpandedContact(null); }}
                    placeholder="Search by name…"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                </View>
                <ScrollView contentContainerStyle={styles.panelScroll}>
                  {contactsList
                    .filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase()))
                    .map((contact, i) => (
                      <View key={i} style={styles.pickerContact}>
                        <TouchableOpacity
                          style={styles.pickerNameRow}
                          onPress={() => setExpandedContact(expandedContact === i ? null : i)}
                        >
                          <Text style={styles.pickerName}>{contact.name || contact.phones[0]}</Text>
                          <Text style={styles.pickerChevron}>{expandedContact === i ? '▲' : '▼'}</Text>
                        </TouchableOpacity>
                        {expandedContact === i && contact.phones.map((phone, j) => (
                          <TouchableOpacity key={j} style={styles.pickerPhoneRow} onPress={() => handlePickerSelect(phone, contact.name)}>
                            <Text style={styles.pickerPhone}>{phone}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                </ScrollView>
                {alertOverlay}
              </View>
            </Modal>
            {alertOverlay}
          </View>
        </Modal>
      )}

      {alertOverlay}

      {/* Gear dropdown */}
      {gearMenuVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setGearMenuVisible(false)}>
          <TouchableOpacity style={styles.dropBackdrop} activeOpacity={1} onPress={() => setGearMenuVisible(false)}>
            <View style={[styles.dropdown, { position: 'absolute', top: gearDropPos.top, right: gearDropPos.right }]}>
              <TouchableOpacity style={styles.dropRow} onPress={() => {
                setGearMenuVisible(false);
                requestAppPermission('contacts', () => { loadJoinedGuests(); setShowManageGuestsPanel(true); }, params.organiserPhone);
              }}>
                <Text style={styles.dropText}>Manage Guests</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Manage Guests panel */}
      <Modal visible={showManageGuestsPanel} animationType="slide" onRequestClose={() => setShowManageGuestsPanel(false)}>
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Manage Guests{joinedGuests.filter(g => g.role !== 'organiser').length > 0 ? ` (${joinedGuests.filter(g => g.role !== 'organiser').length})` : ''}{joinedGuestsTotalPhotos != null ? ` · ${joinedGuestsTotalPhotos} photos` : ''}</Text>
            <TouchableOpacity onPress={() => setShowManageGuestsPanel(false)}>
              <Text style={styles.panelClose}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.panelDesc}>Block a guest to remove their access to this event. They will not be able to rejoin. You can unblock them at any time.</Text>
          <SearchBox value={joinedSearch} onChange={setJoinedSearch} />
          <ScrollView contentContainerStyle={styles.panelScroll}>
            {joinedGuestsLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
            ) : joinedGuestsError ? (
              <View style={styles.guestErrorBox}>
                <Text style={styles.guestErrorText}>{joinedGuestsError}</Text>
                <TouchableOpacity onPress={loadJoinedGuests} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : joinedGuests.length <= 1 ? (
              <>
                {joinedGuests.map(guest => {
                  const contactName = guestContactMap[guest.mobile];
                  const displayName = contactName || guest.name || guest.mobile;
                  const subName = contactName && guest.name && guest.name !== contactName ? guest.name : null;
                  return (
                    <View key={guest.mobile} style={styles.coadminRow}>
                      <View style={styles.coadminInfo}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.coadminName}>{displayName}</Text>
                          <Text style={[styles.coadminPhone, { marginLeft: 6 }]}>· {guest.photo_count ?? 0} photos</Text>
                        </View>
                        {subName ? <Text style={styles.coadminPhone}>{subName}</Text> : null}
                        <Text style={styles.coadminPhone}>{guest.mobile}</Text>
                      </View>
                    </View>
                  );
                })}
                <Text style={[styles.emptyText, { marginTop: 12 }]}>No guests have joined this event yet.</Text>
              </>
            ) : shownJoined.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 12 }]}>No one matches that search.</Text>
            ) : (
              shownJoined.map(guest => {
                const contactName = guestContactMap[guest.mobile] ?? null;
                const appName = guest.name || guest.mobile;
                return (
                  <View key={guest.mobile} style={[styles.coadminRow, guest.is_blocked && styles.blockedRow]}>
                    <View style={styles.coadminInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.coadminName, guest.is_blocked && styles.blockedText]}>{appName}</Text>
                        <Text style={[styles.coadminPhone, { marginLeft: 6 }, guest.is_blocked && styles.blockedText]}>· {guest.photo_count ?? 0} photos</Text>
                      </View>
                      <Text style={[styles.coadminPhone, guest.is_blocked && styles.blockedText]}>{contactName || 'Number not in contacts'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.coadminPhone, guest.is_blocked && styles.blockedText]}>{guest.mobile}</Text>
                        {guest.is_blocked && <Text style={[styles.blockedBadge, { marginLeft: 6 }]}>· BLOCKED</Text>}
                      </View>
                    </View>
                    {guest.mobile === params.organiserPhone ? null : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {guest.role === 'coadmin' && <Text style={styles.coadminBadge}>Admin</Text>}
                        {togglingGuest === guest.mobile ? (
                          <ActivityIndicator size="small" color={Colors.accent} />
                        ) : (
                          <TouchableOpacity
                            style={[styles.removeBtn, guest.is_blocked && styles.unblockBtn]}
                            onPress={() => handleToggleBlock(guest.mobile, guest.is_blocked)}
                          >
                            <Text style={[styles.removeBtnText, guest.is_blocked && styles.unblockBtnText]}>
                              {guest.is_blocked ? 'Unblock' : 'Block'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
          {alertOverlay}
        </View>
      </Modal>

      {Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible={showExtendPicker} onRequestClose={() => setShowExtendPicker(false)}>
          <View style={styles.iosPickerOverlay}>
            <View style={styles.iosPickerCard}>
              <Text style={styles.iosPickerTitle}>Select new expiry date</Text>
              <View style={{ alignItems: 'center' }}>
                <DateTimePicker
                  value={extendPickerDate}
                  mode="date"
                  display="inline"
                  minimumDate={new Date()}
                  onChange={(_, date) => { if (date) setExtendPickerDate(date); }}
                />
              </View>
              <View style={styles.iosPickerBtns}>
                <TouchableOpacity style={styles.iosPickerCancelBtn} onPress={() => setShowExtendPicker(false)}>
                  <Text style={styles.iosPickerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iosPickerConfirmBtn} onPress={confirmExtendIos}>
                  <Text style={styles.iosPickerConfirmText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {primingOverlay}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, paddingRight: 4 },
  pageTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  back: { fontSize: 24, color: Colors.textMuted },
  eventName: { ...Typography.eventName, color: Colors.white, marginBottom: 4 },
  eventSub: { ...Typography.body, color: '#666', marginBottom: 24 },
  codeHighlight: { color: Colors.accent, fontWeight: '800', letterSpacing: 1 },
  sectionLabel: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  btn: { flex: 1, backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, padding: 11, alignItems: 'center' },
  btnText: { fontSize: 13, fontWeight: '700', color: '#CCC' },
  emptyText: { fontSize: 13, color: '#555', marginBottom: 10 },
  panelEmpty: { fontSize: 13, color: '#555', lineHeight: 20, paddingHorizontal: 4 },
  manageGuestsInline: { fontSize: 13, fontWeight: '600', color: Colors.accent, marginTop: 6 },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 4,
    borderWidth: 0.5, borderColor: '#2A2A2A',
  },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { fontSize: 14, fontWeight: '700', color: Colors.white },
  settingDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  settingLocked: { fontSize: 11, color: '#555', marginTop: 4, fontStyle: 'italic' },
  coadminRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 8,
    borderWidth: 0.5, borderColor: '#2A2A2A',
  },
  coadminInfo: { flex: 1 },
  coadminName: { fontSize: 14, fontWeight: '700', color: Colors.white },
  coadminPhone: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  coadminBadge: { fontSize: 11, fontWeight: '700', color: Colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 0.5, borderColor: Colors.accent, overflow: 'hidden' },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 6, borderWidth: 0.5, borderColor: 'rgba(229,57,53,0.4)' },
  removeBtnText: { fontSize: 12, fontWeight: '700', color: '#E53935' },
  addCoadminBtn: { flex: 0, marginTop: 4, borderColor: Colors.accent },
  divider: { height: 0.5, backgroundColor: '#222', marginVertical: 20 },
  bottomBtnRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  openBtn: { flex: 1, backgroundColor: Colors.accent, borderRadius: 12, padding: 16, alignItems: 'center' },
  openBtnText: { ...Typography.buttonText, color: Colors.background },
  deleteBtn: { flex: 1, backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: 'rgba(229,57,53,0.6)', borderRadius: 8, padding: 12, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { ...Typography.buttonText, color: '#E53935' },
  deletingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  deletingText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  deleteModal: { width: '100%', backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, borderWidth: 0.5, borderColor: '#333' },
  deleteModalTitle: { fontSize: 16, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  deleteModalWarning: { fontSize: 13, color: '#888780', lineHeight: 20, marginBottom: 20 },
  deletePasswordInput: { backgroundColor: '#111', borderWidth: 0.5, borderColor: '#333', borderRadius: 10, padding: 14, fontSize: 15, color: Colors.white, marginBottom: 10 },
  deletePasswordError: { fontSize: 13, color: '#E53935', marginBottom: 10 },
  deleteModalButtons: { flexDirection: 'row', gap: 10 },
  deleteModalCancel: { flex: 1, borderWidth: 1.5, borderColor: '#333', borderRadius: 10, padding: 14, alignItems: 'center' },
  deleteModalCancelText: { fontSize: 15, fontWeight: '700', color: '#888780' },
  deleteModalConfirm: { flex: 1, backgroundColor: '#E53935', borderRadius: 10, padding: 14, alignItems: 'center' },
  deleteModalConfirmText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  panelTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  panelClose: { fontSize: 28, color: Colors.textMuted, paddingHorizontal: 4 },
  panelDesc: { fontSize: 13, color: Colors.textMuted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, lineHeight: 19 },
  panelScroll: { padding: 16, gap: 8 },
  pickerSearchWrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  pickerSearch: { backgroundColor: '#1E1E1E', borderRadius: 8, padding: 10, fontSize: 14, color: Colors.white, borderWidth: 0.5, borderColor: '#333' },
  pickerContact: { borderBottomWidth: 0.5, borderBottomColor: '#1E1E1E' },
  pickerBadgeRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  pickerBadgeText: { flex: 1 },
  pickerPhoneLine: { flexDirection: 'row', alignItems: 'center' },
  pickerNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4 },
  pickerName: { fontSize: 15, fontWeight: '700', color: Colors.white, flex: 1 },
  pickerChevron: { fontSize: 11, color: Colors.textMuted, marginLeft: 8 },
  pickerPhoneRow: { paddingVertical: 10, paddingLeft: 16, paddingRight: 4, backgroundColor: '#141414' },
  pickerPhone: { fontSize: 14, color: Colors.accent },
  manualOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  manualCard: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 24, gap: 16 },
  manualTitle: { fontSize: 16, fontWeight: '700', color: Colors.white },
  manualInput: { backgroundColor: '#252525', borderWidth: 0.5, borderColor: '#333', borderRadius: 8, padding: 12, fontSize: 15, color: Colors.white },
  manualBtns: { flexDirection: 'row', gap: 10 },
  manualCancel: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#252525', alignItems: 'center' },
  manualCancelText: { fontSize: 14, fontWeight: '700', color: Colors.textMuted },
  manualAdd: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: Colors.accent, alignItems: 'center' },
  manualAddText: { fontSize: 14, fontWeight: '700', color: Colors.background },
  iosPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  iosPickerCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 8 },
  iosPickerTitle: { color: '#111', fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
  iosPickerBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12 },
  iosPickerCancelBtn: { padding: 12, flex: 1, alignItems: 'center' },
  iosPickerCancelText: { color: '#555', fontSize: 15 },
  iosPickerConfirmBtn: { padding: 12, flex: 1, alignItems: 'center', backgroundColor: Colors.accent, borderRadius: 10 },
  iosPickerConfirmText: { color: Colors.background, fontSize: 15, fontWeight: '700' },
  headerGear: { marginLeft: 'auto', padding: 4 },
  headerGearIcon: { fontSize: 20 },
  dropBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  dropdown: { backgroundColor: '#1C1C1C', borderRadius: 12, borderWidth: 0.5, borderColor: '#333', overflow: 'hidden' },
  dropRow: { paddingHorizontal: 16, paddingVertical: 14 },
  dropText: { fontSize: 14, fontWeight: '600', color: Colors.white },
  blockedRow: { opacity: 0.6 },
  blockedText: { color: Colors.textMuted },
  blockedBadge: { fontSize: 10, fontWeight: '800', color: '#E53935', marginTop: 4 },
  unblockBtn: { backgroundColor: 'rgba(100,220,100,0.08)', borderColor: 'rgba(100,220,100,0.3)' },
  unblockBtnText: { color: '#4CAF50' },
  guestErrorBox: { alignItems: 'center', paddingVertical: 24 },
  guestErrorText: { fontSize: 13, color: '#E53935', textAlign: 'center', marginBottom: 12 },
  retryBtn: { borderWidth: 1, borderColor: '#444', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
});
