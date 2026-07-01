import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { getUserProfile, UserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    getUserProfile().then(setProfile);
  }, []);

  async function checkForUpdates() {
    if (__DEV__) {
      Alert.alert('Updates disabled', 'Update checks only work in the built app, not in Expo Go.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        Alert.alert(
          'Update available',
          'A new version is ready. The app will restart to apply it.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Update now',
              onPress: async () => {
                await Updates.fetchUpdateAsync();
                await Updates.reloadAsync();
              },
            },
          ]
        );
      } else {
        Alert.alert('Up to date', 'You already have the latest version.');
      }
    } catch {
      Alert.alert('Error', 'Could not check for updates. Make sure you are connected to the internet.');
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Settings modal */}
      <Modal
        visible={settingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setSettingsVisible(false)}>
          <View style={styles.settingsSheet}>
            <Text style={styles.settingsTitle}>Settings</Text>

            <TouchableOpacity style={styles.settingsRow} onPress={checkForUpdates} disabled={checkingUpdate}>
              <Text style={styles.settingsRowIcon}>🔄</Text>
              <View style={styles.settingsRowBody}>
                <Text style={styles.settingsRowLabel}>Check for Updates</Text>
                <Text style={styles.settingsRowSub}>Version {Updates.runtimeVersion ?? '1.0.0'}</Text>
              </View>
              {checkingUpdate && <ActivityIndicator size="small" color={Colors.accent} />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.appName}>MomentsInFrame</Text>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.heading}>
          Hello, <Text style={styles.accent}>{profile?.firstName ?? '...'}</Text> 👋
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>WHAT WOULD YOU LIKE TO DO?</Text>

        <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push('/(auth)/join-event')}>
          <View style={[styles.iconWrap, styles.iconPrimary]}>
            <Text style={styles.iconText}>📷</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleDark}>Join An Event</Text>
            <Text style={styles.cardDescDark}>Scan a QR code or enter an event code to view and share photos.</Text>
          </View>
          <Text style={styles.arrowDark}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/(auth)/event-admin-login')}>
          <View style={[styles.iconWrap, styles.iconSecondary]}>
            <Text style={styles.iconText}>🔐</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleLight}>Event Admin Login</Text>
            <Text style={styles.cardDescLight}>Manage an existing event with your event admin password.</Text>
          </View>
          <Text style={styles.arrowLight}>›</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.masterLink} onPress={() => router.push('/(auth)/master-admin-login')}>
        <Text style={styles.masterLinkText}>Master admin →</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  appName: { fontSize: 18, fontWeight: '800', color: Colors.white, letterSpacing: 0.3 },
  settingsBtn: { padding: 4 },
  settingsIcon: { fontSize: 22, color: '#555' },
  greeting: { fontSize: 12, color: Colors.textMuted, marginBottom: 2 },
  heading: { fontSize: 22, fontWeight: '800', color: Colors.white },
  accent: { color: Colors.accent },

  // Body
  body: { flex: 1, padding: 24 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 16 },

  // Cards
  cardPrimary: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  cardSecondary: {
    backgroundColor: Colors.card,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconPrimary: { backgroundColor: 'rgba(0,0,0,0.12)' },
  iconSecondary: { backgroundColor: '#2A2A2A' },
  iconText: { fontSize: 20 },
  cardBody: { flex: 1 },
  cardTitleDark: { fontSize: 15, fontWeight: '800', color: '#0F0F0F', marginBottom: 3 },
  cardTitleLight: { fontSize: 15, fontWeight: '800', color: Colors.white, marginBottom: 3 },
  cardDescDark: { fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 16 },
  cardDescLight: { fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  arrowDark: { fontSize: 24, color: 'rgba(0,0,0,0.4)' },
  arrowLight: { fontSize: 24, color: '#333' },

  // Master admin link
  masterLink: {
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 0.5,
    borderTopColor: '#1A1A1A',
  },
  masterLinkText: { fontSize: 15, color: '#666', fontWeight: '600' },

  // Settings modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 80,
    paddingRight: 16,
  },
  settingsSheet: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    minWidth: 220,
    overflow: 'hidden',
  },
  settingsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#2a2a2a',
  },
  settingsRowIcon: { fontSize: 18 },
  settingsRowBody: { flex: 1 },
  settingsRowLabel: { fontSize: 14, fontWeight: '600', color: Colors.white },
  settingsRowSub: { fontSize: 11, color: '#555', marginTop: 1 },
});
