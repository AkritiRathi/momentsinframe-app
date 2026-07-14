import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Switch, BackHandler, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { Clipboard } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Contacts from 'expo-contacts';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { extendEvent, deleteEvent, listCoadmins, addCoadmin, removeCoadmin, updateEventSettings, listAllowedGuests, addAllowedGuests, removeAllowedGuest, listJoinedGuests } from '../../lib/api';
import { API_BASE_URL } from '../../constants/config';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Coadmin = { phone: string; name: string | null; added_at: string };
type AllowedGuest = { phone: string; name: string | null; added_at: string };

export default function EventDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();
  const params = useLocalSearchParams<{
    id: string; name: string; slug: string; join_code: string;
    created_at: string; expires_at: string; photo_count: string;
    is_closed: string; allow_guest_delete: string; organiserPhone: string;
  }>();

  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [extendPickerDate, setExtendPickerDate] = useState<Date>(new Date());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteStep, setDeleteStep] = useState<null | 'password' | 'confirm'>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState<string | null>(null);
  const [deletePasswordLoading, setDeletePasswordLoading] = useState(false);
  const [allowGuestDelete, setAllowGuestDelete] = useState(params.allow_guest_delete === 'true');
  const [isClosed, setIsClosed] = useState(params.is_closed === 'true');
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [closedUpdating, setClosedUpdating] = useState(false);
  const [coadmins, setCoadmins] = useState<Coadmin[]>([]);
  const [coadminsLoading, setCoadminsLoading] = useState(true);
  const [addingCoadmin, setAddingCoadmin] = useState(false);
  const [showCoadminPanel, setShowCoadminPanel] = useState(false);
  const [allowedGuests, setAllowedGuests] = useState<AllowedGuest[]>([]);
  const [allowedGuestsLoading, setAllowedGuestsLoading] = useState(false);
  const [addingGuest, setAddingGuest] = useState(false);
  const [showGuestsPanel, setShowGuestsPanel] = useState(false);

  type PickerContact = { name: string; phones: string[] };
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPickerMode, setContactPickerMode] = useState<'coadmin' | 'guest'>('coadmin');
  const [contactsList, setContactsList] = useState<PickerContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [expandedContact, setExpandedContact] = useState<number | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualInputMode, setManualInputMode] = useState<'coadmin' | 'guest'>('coadmin');
  const [manualPhone, setManualPhone] = useState('');

  const loadCoadmins = useCallback(async () => {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    setCoadminsLoading(true);
    try {
      const result = await listCoadmins(params.slug, params.organiserPhone, pw);
      if (result.coadmins) setCoadmins(result.coadmins);
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
      const result = await listAllowedGuests(params.slug, params.organiserPhone, pw);
      if (result.guests) setAllowedGuests(result.guests);
    } finally {
      setAllowedGuestsLoading(false);
    }
  }, [params.slug, params.organiserPhone]);

  useEffect(() => { if (isClosed) loadAllowedGuests(); }, [isClosed, loadAllowedGuests]);

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

  async function handleToggleIsClosed(value: boolean) {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;

    if (value) {
      // Closing the event — fetch existing joined guests and warn organiser
      setClosedUpdating(true);
      let joinedGuests: { name: string; mobile: string }[] = [];
      try {
        const res = await listJoinedGuests(params.slug, params.organiserPhone, pw);
        joinedGuests = res.guests ?? [];
      } finally {
        setClosedUpdating(false);
      }

      if (joinedGuests.length > 0) {
        showAlert(
          'Close this event?',
          `${joinedGuests.length} guest${joinedGuests.length !== 1 ? 's' : ''} have already joined. They will lose access unless added to the allowed list.\n\nAdd them all now?`,
          [
            {
              text: 'Yes, add them',
              onPress: async () => {
                setClosedUpdating(true);
                await updateEventSettings(params.slug, params.organiserPhone!, pw, { isClosed: true });
                await addAllowedGuests(params.slug, params.organiserPhone!, pw,
                  joinedGuests.map(g => ({ phone: g.mobile, name: g.name }))
                );
                setIsClosed(true);
                await loadAllowedGuests();
                setClosedUpdating(false);
                setShowGuestsPanel(true);
              },
            },
            {
              text: 'No, close without adding',
              style: 'destructive',
              onPress: async () => {
                setClosedUpdating(true);
                await updateEventSettings(params.slug, params.organiserPhone!, pw, { isClosed: true });
                setIsClosed(true);
                setClosedUpdating(false);
                setShowGuestsPanel(true);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      } else {
        setClosedUpdating(true);
        await updateEventSettings(params.slug, params.organiserPhone, pw, { isClosed: true });
        setIsClosed(true);
        setClosedUpdating(false);
        setShowGuestsPanel(true);
      }
    } else {
      // Reopening the event
      setClosedUpdating(true);
      await updateEventSettings(params.slug, params.organiserPhone, pw, { isClosed: false });
      setIsClosed(false);
      setClosedUpdating(false);
    }
  }

  function copyCode() {
    const text = `Event: ${params.name}\nEvent Code: ${params.join_code}`;
    Clipboard.setString(text);
    showAlert('Copied', `Event: ${params.name}\nEvent Code: ${params.join_code}`);
  }

  async function handleExtend() {
    const current = params.expires_at ? new Date(params.expires_at) : new Date();
    if (Platform.OS === 'ios') {
      setExtendPickerDate(current);
      setShowExtendPicker(true);
    } else {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        minimumDate: new Date(),
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
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow access to contacts.');
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

  function handlePickerSelect(phone: string, name: string) {
    setShowContactPicker(false);
    if (contactPickerMode === 'coadmin') {
      confirmAddCoadmin(phone, name);
    } else {
      confirmAddGuest(phone, name);
    }
  }

  async function handleAddCoadmin() {
    await Contacts.requestPermissionsAsync();
    showAlert(
      'Add Co-Admin',
      'How would you like to add a co-admin?',
      [
        { text: 'From contacts', onPress: () => loadContactsForPicker('coadmin') },
        { text: 'Enter number manually', onPress: () => { setManualInputMode('coadmin'); setManualPhone(''); setShowManualInput(true); } },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function confirmAddCoadmin(phone: string, name: string | null) {
    if (coadmins.some(c => c.phone === phone)) {
      showAlert('Already added', `${name ?? phone} is already a co-admin.`);
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
    await Contacts.requestPermissionsAsync();
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
    if (allowedGuests.some(g => g.phone === phone)) {
      showAlert('Already added', `${name ?? phone} is already in the allowed guests list.`);
      return;
    }
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
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
      'They will no longer have co-admin access to this event.',
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Manage Event</Text>
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
          <TouchableOpacity style={[styles.btn, { borderColor: Colors.accent }]} onPress={() => setShowCoadminPanel(true)}>
            <Text style={[styles.btnText, { color: Colors.accent }]}>+ Co-Admins</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>SETTINGS</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Allow guests to delete photos</Text>
            <Text style={styles.settingDesc}>Guests can delete their own uploaded photos</Text>
          </View>
          {settingsUpdating
            ? <ActivityIndicator color={Colors.accent} />
            : <Switch
                value={allowGuestDelete}
                onValueChange={handleToggleGuestDelete}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
          }
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Invite-only event</Text>
            <Text style={styles.settingDesc}>
              {isClosed ? 'Only guests on the allowed list can join' : 'Anyone with the event code can join'}
            </Text>
            {isClosed && (
              <TouchableOpacity onPress={() => { loadAllowedGuests(); setShowGuestsPanel(true); }}>
                <Text style={styles.manageGuestsInline}>
                  Manage Guests{allowedGuests.length > 0 ? ` (${allowedGuests.length})` : ''} →
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {closedUpdating
            ? <ActivityIndicator color={Colors.accent} />
            : <Switch
                value={isClosed}
                onValueChange={handleToggleIsClosed}
                trackColor={{ false: '#333', true: Colors.accent }}
                thumbColor={Colors.white}
              />
          }
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
              adminPhone: params.organiserPhone ?? '',
              allowGuestDelete: allowGuestDelete ? 'true' : 'false',
              role: 'organiser',
            },
          })}
        >
          <Text style={styles.openBtnText}>Open Event →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Delete event</Text>
        </TouchableOpacity>
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
      <Modal visible={showCoadminPanel} animationType="slide" onRequestClose={() => setShowCoadminPanel(false)}>
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Co-Admins{coadmins.length > 0 ? ` (${coadmins.length})` : ''}</Text>
            <TouchableOpacity onPress={() => setShowCoadminPanel(false)}>
              <Text style={styles.panelClose}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.panelDesc}>Co-Admins can delete any photo uploaded by any guest or other Co-Admins but not photos uploaded by the Organiser. They join using the event code, just like other guests.</Text>
          <ScrollView contentContainerStyle={styles.panelScroll}>
            {coadminsLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
            ) : coadmins.length === 0 ? (
              <Text style={styles.emptyText}>No co-admins added yet.</Text>
            ) : (
              coadmins.map(ca => (
                <View key={ca.phone} style={styles.coadminRow}>
                  <View style={styles.coadminInfo}>
                    <Text style={styles.coadminName}>{ca.name || ca.phone}</Text>
                    {ca.name ? <Text style={styles.coadminPhone}>{ca.phone}</Text> : null}
                  </View>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveCoadmin(ca.phone, ca.name)}>
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              style={[styles.btn, { marginTop: 12, borderColor: Colors.accent, opacity: addingCoadmin ? 0.5 : 1 }]}
              onPress={handleAddCoadmin}
              disabled={addingCoadmin}
            >
              {addingCoadmin
                ? <ActivityIndicator color={Colors.accent} />
                : <Text style={[styles.btnText, { color: Colors.accent }]}>Add Co-Admin</Text>
              }
            </TouchableOpacity>
          </ScrollView>
          {/* Manual Input — inside co-admin panel so it renders on top */}
          <Modal visible={showManualInput && manualInputMode === 'coadmin'} animationType="fade" transparent onRequestClose={() => setShowManualInput(false)}>
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
                      let name: string | null = contactsList.find(c => c.phones.includes(clean))?.name ?? null;
                      if (!name) {
                        try {
                          const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
                          const match = data.find(c => (c.phoneNumbers ?? []).some(pn => normalizeIndianPhone(pn.number ?? '') === clean));
                          if (match?.name) name = match.name;
                        } catch {}
                      }
                      confirmAddCoadmin(clean, name);
                    }}
                  >
                    <Text style={styles.manualAddText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {alertOverlay}
            </View>
          </Modal>
          {/* Contact Picker — nested inside co-admin modal so iOS can stack it */}
          <Modal visible={showContactPicker && contactPickerMode === 'coadmin'} animationType="slide" onRequestClose={() => setShowContactPicker(false)}>
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
            <ScrollView contentContainerStyle={styles.panelScroll}>
              {allowedGuestsLoading ? (
                <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} />
              ) : allowedGuests.length === 0 ? (
                <Text style={styles.emptyText}>No guests added yet. Add guests to let them in.</Text>
              ) : (
                allowedGuests.map(g => (
                  <View key={g.phone} style={styles.coadminRow}>
                    <View style={styles.coadminInfo}>
                      <Text style={styles.coadminName}>{g.name ?? g.phone}</Text>
                      {g.name ? <Text style={styles.coadminPhone}>{g.phone}</Text> : null}
                    </View>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveGuest(g.phone, g.name)}>
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  pageTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  back: { fontSize: 24, color: Colors.textMuted },
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
  emptyText: { fontSize: 13, color: '#555', marginBottom: 10 },
  manageGuestsInline: { fontSize: 13, fontWeight: '600', color: Colors.accent, marginTop: 6 },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 4,
    borderWidth: 0.5, borderColor: '#2A2A2A',
  },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { fontSize: 14, fontWeight: '700', color: Colors.white },
  settingDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  coadminRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 8,
    borderWidth: 0.5, borderColor: '#2A2A2A',
  },
  coadminInfo: { flex: 1 },
  coadminName: { fontSize: 14, fontWeight: '700', color: Colors.white },
  coadminPhone: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(229,57,53,0.1)', borderRadius: 6, borderWidth: 0.5, borderColor: 'rgba(229,57,53,0.4)' },
  removeBtnText: { fontSize: 12, fontWeight: '700', color: '#E53935' },
  addCoadminBtn: { flex: 0, marginTop: 4, borderColor: Colors.accent },
  divider: { height: 0.5, backgroundColor: '#222', marginVertical: 20 },
  openBtn: { backgroundColor: Colors.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  openBtnText: { ...Typography.buttonText, color: Colors.background },
  deleteBtn: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: 'rgba(229,57,53,0.6)', borderRadius: 8, padding: 12, alignItems: 'center' },
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
});
