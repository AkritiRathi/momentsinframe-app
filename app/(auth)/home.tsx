import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import * as Updates from 'expo-updates';
import { getUserProfile, UserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

const ORGANISER_WHITELIST = ['8826388888', '9899092777', '9899060282'];

export default function HomeScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const gearRef = useRef<TouchableOpacity>(null);

  useEffect(() => {
    getUserProfile().then(setProfile);
  }, []);

  async function checkForUpdates() {
    setSettingsVisible(false);
    await new Promise(r => setTimeout(r, 300));
    if (__DEV__) {
      showAlert('Updates disabled', 'Update checks only work in the built app, not in Expo Go.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        showAlert(
          'Update available',
          'A new version is ready. The app will restart to apply it.',
          [
            {
              text: 'Update now',
              onPress: async () => {
                await Updates.fetchUpdateAsync();
                await Updates.reloadAsync();
              },
            },
            { text: 'Later', style: 'cancel' },
          ]
        );
      } else {
        showAlert('Up to date', 'You already have the latest version.');
      }
    } catch {
      showAlert('Error', 'Could not check for updates. Make sure you are connected to the internet.');
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
          <View style={[styles.settingsSheet, { position: 'absolute', top: dropPos.top, right: dropPos.right }]}>
            <TouchableOpacity style={styles.settingsRow} onPress={checkForUpdates} disabled={checkingUpdate}>
              <View style={styles.settingsRowBody}>
                <Text style={styles.settingsRowLabel}>Check for Updates</Text>
                <Text style={styles.settingsRowSub}>Version {Updates.runtimeVersion ?? '1.0.0'}</Text>
              </View>
              {checkingUpdate && <ActivityIndicator size="small" color={Colors.accent} />}
            </TouchableOpacity>
            <View style={styles.settingsDivider} />
            <TouchableOpacity style={styles.settingsRow} onPress={() => {
              setSettingsVisible(false);
              setTimeout(() => {
                showAlert(
                  'Your Details',
                  `Name: ${profile?.firstName ?? ''} ${profile?.lastName ?? ''}\nMobile: +91 ${profile?.mobile ?? ''}`,
                );
              }, 300);
            }}>
              <View style={styles.settingsRowBody}>
                <Text style={styles.settingsRowLabel}>See user details</Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.appName}>MomentsInFrame</Text>
          <TouchableOpacity ref={gearRef} style={styles.settingsBtn} onPress={() => {
            gearRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
              setDropPos({ top: pageY + height + 4, right: Dimensions.get('window').width - pageX - width });
              setSettingsVisible(true);
            });
          }}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.heading}>
          Welcome <Text style={styles.accent}>{profile?.firstName ?? '...'}</Text> 👋
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>WHAT WOULD YOU LIKE TO DO?</Text>

        <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push('/(auth)/join-event')}>
          <View style={[styles.iconWrap, styles.iconPrimary]}>
            <Text style={styles.iconText}>📷</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleDark}>Join As Guest</Text>
            <Text style={styles.cardDescDark}>Enter an event code to view and share photos.</Text>
          </View>
          <Text style={styles.arrowDark}>›</Text>
        </TouchableOpacity>

        {ORGANISER_WHITELIST.includes(profile?.mobile ?? '') && (
        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/(auth)/organiser-login')}>
          <View style={[styles.iconWrap, styles.iconSecondary]}>
            <Text style={styles.iconText}>🎬</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleLight}>I'm an Organiser</Text>
            <Text style={styles.cardDescLight}>Create and manage your own events.</Text>
          </View>
          <Text style={styles.arrowLight}>›</Text>
        </TouchableOpacity>
        )}
      </View>

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

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
  settingsIcon: { fontSize: 20 },
  heading: { ...Typography.heading, color: Colors.white },
  accent: { color: Colors.accent },

  body: { flex: 1, padding: 24 },
  sectionLabel: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 16 },

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

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  settingsSheet: {
    backgroundColor: '#1C1C1C',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#333',
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  settingsDivider: { height: 0.5, backgroundColor: '#333' },
  settingsRowBody: {},
  settingsRowLabel: { fontSize: 14, fontWeight: '600', color: Colors.white },
  settingsRowSub: { fontSize: 11, color: '#555', marginTop: 1 },
});
