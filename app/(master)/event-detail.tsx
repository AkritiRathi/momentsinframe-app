import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { Clipboard } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Contacts from 'expo-contacts';
import { getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { extendEvent, deleteEvent, listCoadmins, addCoadmin, removeCoadmin, lookupUsers } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Coadmin = { phone: string; name: string | null; added_at: string };

export default function EventDetailScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const params = useLocalSearchParams<{
    id: string; name: string; slug: string; join_code: string;
    created_at: string; expires_at: string; photo_count: string;
    is_closed: string; allow_guest_delete: string; organiserPhone: string;
  }>();

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [coadmins, setCoadmins] = useState<Coadmin[]>([]);
  const [coadminsLoading, setCoadminsLoading] = useState(true);
  const [addingCoadmin, setAddingCoadmin] = useState(false);

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

  function copyCode() {
    const text = `Event: ${params.name}\nEvent Code: ${params.join_code}`;
    Clipboard.setString(text);
    showAlert('Copied', `Event: ${params.name}\nEvent Code: ${params.join_code}`);
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

  function handleDelete() {
    showAlert(
      `Delete "${params.name}"?`,
      'This action is permanent and cannot be undone. All photos will be deleted.',
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const profile = await getUserProfile();
            const pw = await getOrganiserPassword();
            if (!profile || !pw) return;
            setDeleteLoading(true);
            const result = await deleteEvent(params.slug, profile.mobile, pw);
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

  async function handleAddCoadmin() {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow access to contacts to add a co-admin.');
      return;
    }

    const { data: contacts } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
    });

    const eligible = contacts.filter(c => c.phoneNumbers && c.phoneNumbers.length > 0);
    if (eligible.length === 0) {
      showAlert('No contacts', 'No contacts with phone numbers found.');
      return;
    }

    // Collect all phone numbers and normalise to digits only
    const allPhones: { raw: string; normalised: string; contactIndex: number; numberIndex: number }[] = [];
    eligible.forEach((c, ci) => {
      (c.phoneNumbers ?? []).forEach((pn, ni) => {
        if (pn.number) {
          allPhones.push({
            raw: pn.number,
            normalised: pn.number.replace(/\D/g, ''),
            contactIndex: ci,
            numberIndex: ni,
          });
        }
      });
    });

    setAddingCoadmin(true);
    let registered: string[] = [];
    try {
      const result = await lookupUsers(allPhones.map(p => p.normalised));
      registered = result.registered ?? [];
    } catch {
      showAlert('Error', 'Could not check contacts. Please try again.');
      setAddingCoadmin(false);
      return;
    }
    setAddingCoadmin(false);

    // Build list of contacts that have a registered number
    const registeredSet = new Set(registered);
    const options: { label: string; phone: string; name: string }[] = [];
    eligible.forEach((c) => {
      const phones = (c.phoneNumbers ?? [])
        .map(pn => pn.number?.replace(/\D/g, '') ?? '')
        .filter(n => registeredSet.has(n));
      if (phones.length > 0) {
        options.push({ label: c.name ?? phones[0], phone: phones[0], name: c.name ?? '' });
      }
    });

    if (options.length === 0) {
      showAlert('No matches', 'None of your contacts have joined MomentsInFrame yet.');
      return;
    }

    // Show native action sheet to pick
    Alert.alert(
      'Add Co-Admin',
      'Select a contact to add as co-admin:',
      [
        ...options.slice(0, 8).map(o => ({
          text: o.label,
          onPress: () => confirmAddCoadmin(o.phone, o.name),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }

  async function confirmAddCoadmin(phone: string, name: string) {
    const pw = await getOrganiserPassword();
    if (!pw || !params.organiserPhone) return;
    const result = await addCoadmin(params.slug, params.organiserPhone, pw, phone, name);
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      await loadCoadmins();
    }
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
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>

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
        </View>

        <Text style={styles.sectionLabel}>CO-ADMINS</Text>
        {coadminsLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginVertical: 12 }} />
        ) : (
          <>
            {coadmins.length === 0 ? (
              <Text style={styles.emptyText}>No co-admins added yet.</Text>
            ) : (
              coadmins.map(ca => (
                <View key={ca.phone} style={styles.coadminRow}>
                  <View style={styles.coadminInfo}>
                    <Text style={styles.coadminName}>{ca.name ?? ca.phone}</Text>
                    {ca.name ? <Text style={styles.coadminPhone}>{ca.phone}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemoveCoadmin(ca.phone, ca.name)}
                  >
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              style={[styles.btn, styles.addCoadminBtn, addingCoadmin && { opacity: 0.5 }]}
              onPress={handleAddCoadmin}
              disabled={addingCoadmin}
            >
              {addingCoadmin
                ? <ActivityIndicator color={Colors.accent} />
                : <Text style={[styles.btnText, { color: Colors.accent }]}>+ Add Co-Admin</Text>
              }
            </TouchableOpacity>
          </>
        )}

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
              adminPassword: '',
              adminPhone: params.organiserPhone ?? '',
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

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20 },
  back: { fontSize: 24, color: Colors.textMuted, marginBottom: 16 },
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
  deletingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', gap: 16 },
  deletingText: { fontSize: 15, fontWeight: '700', color: Colors.white },
});
