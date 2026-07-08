import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { organiserSetup, organiserLogin } from '../../lib/api';
import { saveOrganiserSession, isOrganiser } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function OrganiserLoginScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [isFirstTime, setIsFirstTime] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if this user already has an organiser account
    isOrganiser().then(has => setIsFirstTime(!has));
  }, []);

  async function handleSubmit() {
    const profile = await getUserProfile();
    if (!profile) {
      showAlert('Error', 'Could not load your profile. Please restart the app.');
      return;
    }

    if (isFirstTime) {
      if (password.length < 6) {
        showAlert('Password too short', 'Your organiser password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        showAlert('Passwords do not match', 'Please make sure both passwords are the same.');
        return;
      }
      setLoading(true);
      try {
        const result = await organiserSetup(profile.mobile, `${profile.firstName} ${profile.lastName}`, password);
        if (result.error) {
          showAlert('Setup failed', result.error);
          return;
        }
        await saveOrganiserSession(password);
        router.replace('/(master)/dashboard');
      } catch {
        showAlert('Error', 'Something went wrong. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    } else {
      if (!password) {
        showAlert('Enter your password', 'Please enter your organiser password to continue.');
        return;
      }
      setLoading(true);
      try {
        const result = await organiserLogin(profile.mobile, password);
        if (result.error) {
          showAlert('Incorrect password', 'The password you entered is incorrect.');
          return;
        }
        await saveOrganiserSession(password);
        router.replace('/(master)/dashboard');
      } catch {
        showAlert('Error', 'Something went wrong. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    }
  }

  if (isFirstTime === null) return null;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>
            {isFirstTime ? 'Set Up As Organiser' : 'Organiser Login'}
          </Text>
          <Text style={styles.subtitle}>
            {isFirstTime
              ? 'Create a password to protect your organiser account. You\'ll use this every time you manage your events.'
              : 'Enter your organiser password to access your events.'}
          </Text>

          <Text style={styles.label}>PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder={isFirstTime ? 'Create a password' : 'Enter your password'}
              placeholderTextColor="#555"
              autoFocus
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {isFirstTime && (
            <>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                placeholder="Re-enter your password"
                placeholderTextColor="#555"
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading ? 'Please wait…' : isFirstTime ? 'Create Account' : 'Continue →'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  back: { paddingTop: 16, paddingHorizontal: 16 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { padding: 24, paddingTop: 16 },
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 32 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8 },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
    marginBottom: 20,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    marginBottom: 20,
  },
  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
  },
  eyeBtn: { paddingHorizontal: 14 },
  eyeIcon: { fontSize: 18 },
  btn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { ...Typography.buttonText, color: Colors.background },
});
