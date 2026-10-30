import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Dimensions, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useCallback, useState, useRef } from 'react';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserProfile, clearUserProfile, UserProfile, getSessionExpiry } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';
import { checkWhitelist, checkUserStatus, deleteAccount, organiserLogin, logoutUser, getOrganiserEventCount } from '../../lib/api';

export default function HomeScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [userDetailsVisible, setUserDetailsVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const [deletePasswordVisible, setDeletePasswordVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const gearRef = useRef<TouchableOpacity>(null);
  // ⭐ LOGIN-ENDS STRIP (2026-10-30, the user: option D, "3", "Only on the
  // Welcome <name> screen/Home screen"): from 3 days before this device's
  // 30-day login ends, a strip under "Welcome" offers Renew now. Shown here ONLY.
  const [loginEndsAt, setLoginEndsAt] = useState<Date | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        getSessionExpiry().then(iso => {
          const at = iso ? new Date(iso) : null;
          const msLeft = at ? at.getTime() - Date.now() : -1;
          setLoginEndsAt(at && msLeft > 0 && msLeft <= 3 * 24 * 60 * 60 * 1000 ? at : null);
        }).catch(() => setLoginEndsAt(null));
        const p = await getUserProfile();
        if (!p?.mobile) { setProfile(p); return; }

        // Show name immediately from local storage, then verify in background
        setProfile(p);

        const [status, whitelistResult] = await Promise.all([
          checkUserStatus(p.mobile).catch(() => ({ active: true })),
          checkWhitelist(p.mobile).catch(() => ({ whitelisted: false })),
        ]);

        if (!status.active) {
          await clearUserProfile();
          router.replace('/(auth)/login');
          return;
        }

        setIsWhitelisted(whitelistResult.whitelisted);
      })();
    }, [])
  );

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

  async function checkOrganiserHasEvents(): Promise<number> {
    if (!profile?.mobile) return 0;
    return getOrganiserEventCount(profile.mobile).catch(() => 0);
  }

  async function handleDeleteAccountPress() {
    setUserDetailsVisible(false);
    const eventCount = await checkOrganiserHasEvents();
    if (eventCount > 0) {
      showAlert('Cannot Delete Account', `You have ${eventCount} active event${eventCount !== 1 ? 's' : ''}. Please delete all your events before deleting your account.`);
      return;
    }
    setTimeout(() => {
      if (isWhitelisted) {
        setDeletePassword('');
        setDeletePasswordError('');
        setDeletePasswordVisible(true);
      } else {
        showDeleteConfirmation();
      }
    }, 300);
  }

  function showDeleteConfirmation() {
    showAlert(
      'Delete Account',
      'You will be removed from all events, Admin roles, and Organiser access. Your photos will remain but show as Unknown User. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            const p = await getUserProfile();
            if (!p) return;
            await deleteAccount(p.mobile);
            await clearUserProfile();
            await AsyncStorage.clear();
            router.replace('/(auth)/name-entry');
          },
        },
      ]
    );
  }

  async function handleDeletePasswordConfirm() {
    if (!deletePassword.trim()) {
      setDeletePasswordError('Please enter your Organiser password.');
      return;
    }
    if (!profile) return;
    setDeletingAccount(true);
    setDeletePasswordError('');
    const result = await organiserLogin(profile.mobile, deletePassword);
    setDeletingAccount(false);
    if (!result.success) {
      setDeletePasswordError('Incorrect password. Please try again.');
      return;
    }
    setDeletePasswordVisible(false);
    setTimeout(() => showDeleteConfirmation(), 300);
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Password verification modal for organiser delete */}
      <Modal
        visible={deletePasswordVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeletePasswordVisible(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDeletePasswordVisible(false)}>
          <View style={styles.userDetailsSheet}>
            <Text style={styles.userDetailsTitle}>Confirm Password</Text>
            <Text style={styles.userDetailsText}>Enter your Organiser password to delete your account.</Text>
            <TextInput
              style={[styles.passwordInput, deletePasswordError ? styles.passwordInputError : null]}
              placeholder="Organiser password"
              placeholderTextColor="#555"
              secureTextEntry
              value={deletePassword}
              onChangeText={v => { setDeletePassword(v); setDeletePasswordError(''); }}
              autoFocus
            />
            {!!deletePasswordError && (
              <Text style={styles.passwordErrorText}>{deletePasswordError}</Text>
            )}
            <View style={styles.userDetailsButtons}>
              <TouchableOpacity style={styles.logoutBtn} onPress={() => setDeletePasswordVisible(false)}>
                <Text style={styles.logoutBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={handleDeletePasswordConfirm} disabled={deletingAccount}>
                {deletingAccount
                  ? <ActivityIndicator size="small" color="#0F0F0F" />
                  : <Text style={styles.okBtnText}>Confirm</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* User details modal */}
      <Modal
        visible={userDetailsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUserDetailsVisible(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setUserDetailsVisible(false)}>
          <View style={styles.userDetailsSheet}>
            <Text style={styles.userDetailsTitle}>Your Details</Text>
            <Text style={styles.userDetailsText}>Name: {profile?.firstName ?? ''} {profile?.lastName ?? ''}</Text>
            <Text style={styles.userDetailsText}>Mobile: +91 {profile?.mobile ?? ''}</Text>
            <View style={styles.userDetailsButtons}>
              <TouchableOpacity style={styles.logoutBtn} onPress={async () => {
                setUserDetailsVisible(false);
                const eventCount = await checkOrganiserHasEvents();
                if (eventCount > 0) {
                  showAlert('Cannot Log Out', `You have ${eventCount} active event${eventCount !== 1 ? 's' : ''}. Please delete all your events before logging out.`);
                  return;
                }
                setTimeout(() => {
                  // ⭐ "Log out from all devices" (2026-10-30, the user's yes):
                  // also ends this number's login on every other phone and
                  // browser. Main buttons first, Cancel last (app convention).
                  const finishLocalLogout = async () => {
                    await clearUserProfile();
                    await AsyncStorage.clear();
                    router.replace('/(auth)/name-entry');
                  };
                  showAlert(
                    'Log out?',
                    'You will be removed from all events you have joined, including any Admin roles. Your uploaded photos will remain with your name. If you log in again with the same number, you can rejoin open events and manage your photos.\n\n"Log out from all devices" also logs you out on your other phones and browsers.',
                    [
                      {
                        text: 'Log out', onPress: async () => {
                          const profile = await getUserProfile();
                          if (profile?.mobile) await logoutUser(profile.mobile).catch(() => false);
                          await finishLocalLogout();
                        },
                      },
                      {
                        text: 'Log out from all devices', onPress: async () => {
                          const profile = await getUserProfile();
                          const ok = profile?.mobile ? await logoutUser(profile.mobile, true).catch(() => false) : false;
                          if (!ok) {
                            // Stay logged in here, so they can try again.
                            setTimeout(() => showAlert(
                              'Could not log out other devices',
                              'Please check your connection and try again. If your login has ended, renew it first.',
                            ), 300);
                            return;
                          }
                          await finishLocalLogout();
                        },
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]
                  );
                }, 300);
              }}>
                <Text style={styles.logoutBtnText}>Logout</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={() => setUserDetailsVisible(false)}>
                <Text style={styles.okBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.deleteAccountBtn} onPress={handleDeleteAccountPress}>
              <Text style={styles.deleteAccountBtnText}>Delete Account</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
                <Text style={styles.settingsRowSub}>Version {Updates.runtimeVersion ?? '1.0.0'} ({Application.nativeBuildVersion})</Text>
              </View>
              {checkingUpdate && <ActivityIndicator size="small" color={Colors.accent} />}
            </TouchableOpacity>
            <View style={styles.settingsDivider} />
            <TouchableOpacity style={styles.settingsRow} onPress={() => {
              setSettingsVisible(false);
              setTimeout(() => setUserDetailsVisible(true), 300);
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
        {loginEndsAt && (
          <View style={styles.loginStrip}>
            <Text style={styles.loginStripText}>Your login ends {describeLoginEnd(loginEndsAt)}.</Text>
            <TouchableOpacity
              style={styles.loginStripBtn}
              onPress={() => router.push({ pathname: '/(auth)/name-entry', params: { renew: 'renew' } })}
            >
              <Text style={styles.loginStripBtnText}>Renew now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>WHAT WOULD YOU LIKE TO DO?</Text>

        <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push('/(auth)/join-event')}>
          <View style={[styles.iconWrap, styles.iconPrimary]}>
            <Text style={styles.iconText}>📷</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleDark}>Guest login</Text>
            <Text style={styles.cardDescDark}>Enter an event code to view and share photos.</Text>
          </View>
          <Text style={styles.arrowDark}>›</Text>
        </TouchableOpacity>

        {isWhitelisted && (
        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/(auth)/organiser-login')}>
          <View style={[styles.iconWrap, styles.iconSecondary]}>
            <Text style={styles.iconText}>🎬</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleLight}>Organiser login</Text>
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

// "today at 8:16 PM" / "tomorrow at 8:16 PM" / "on 2 Nov at 8:16 PM"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function describeLoginEnd(at: Date): string {
  const h = at.getHours() % 12 || 12;
  const time = `${h}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'AM' : 'PM'}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(at); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `on ${at.getDate()} ${MONTHS[at.getMonth()]} at ${time}`;
}

const styles = StyleSheet.create({
  loginStrip: { marginTop: 14, backgroundColor: '#1C1C1C', borderRadius: 12, borderWidth: 1, borderColor: Colors.accent, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loginStripText: { flex: 1, fontSize: 14, color: Colors.white, lineHeight: 20 },
  loginStripBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  loginStripBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
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

  userDetailsSheet: {
    position: 'absolute',
    top: '35%',
    left: 32,
    right: 32,
    backgroundColor: '#1C1C1C',
    borderRadius: 20,
    padding: 24,
  },
  userDetailsTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, textAlign: 'center', marginBottom: 16 },
  userDetailsText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 6 },
  userDetailsButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  logoutBtn: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutBtnText: { fontSize: 15, fontWeight: '700', color: '#FF4444' },
  okBtn: {
    flex: 1,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  okBtnText: { fontSize: 15, fontWeight: '700', color: '#0F0F0F' },
  deleteAccountBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 10 },
  deleteAccountBtnText: { fontSize: 13, color: '#FF4444', fontWeight: '600' },
  passwordInput: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.white,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  passwordInputError: { borderColor: '#FF4444' },
  passwordErrorText: { fontSize: 12, color: '#FF4444', marginTop: 6 },
});
