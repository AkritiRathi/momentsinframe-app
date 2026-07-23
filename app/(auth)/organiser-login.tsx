import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { organiserExists, organiserSetup, organiserLogin, organiserResetPassword, sendOtp, verifyOtp } from '../../lib/api';
import { saveOrganiserSession, getOrganiserPassword } from '../../lib/auth';
import { getUserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

type Mode = 'checking' | 'setup' | 'login' | 'forgot';

export default function OrganiserLoginScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const { showAlert, alertOverlay } = useAlert();
  const [mode, setMode] = useState<Mode>('checking');
  const [forgotStep, setForgotStep] = useState<'send' | 'verify' | 'reset'>('send');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modeParam === 'forgot') {
      setMode('forgot');
      return;
    }
    (async () => {
      const profile = await getUserProfile();
      if (!profile) {
        showAlert('Error', 'Could not load your profile. Please restart the app.');
        return;
      }
      // If a session is already saved on this device, skip password and go straight to My Events
      const savedPassword = await getOrganiserPassword();
      if (savedPassword) {
        router.replace('/(master)/dashboard');
        return;
      }
      try {
        const result = await organiserExists(profile.mobile);
        setMode(result.exists ? 'login' : 'setup');
      } catch {
        showAlert('Error', 'Could not connect. Please check your connection and try again.');
      }
    })();
  }, []);

  async function handleSetup() {
    if (password.length < 6) {
      showAlert('Password too short', 'Your organiser password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Passwords do not match', 'Please make sure both passwords are the same.');
      return;
    }
    const profile = await getUserProfile();
    if (!profile) return;
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
  }

  async function handleLogin() {
    if (!password) {
      showAlert('Enter your password', 'Please enter your organiser password to continue.');
      return;
    }
    const profile = await getUserProfile();
    if (!profile) return;
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

  async function handleSendOtp() {
    const profile = await getUserProfile();
    if (!profile) return;
    setLoading(true);
    try {
      await sendOtp(`91${profile.mobile}`);
      setForgotStep('verify');
    } catch {
      showAlert('Error', 'Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) {
      showAlert('Invalid code', 'Please enter the 6-digit code sent to your WhatsApp.');
      return;
    }
    const profile = await getUserProfile();
    if (!profile) return;
    setLoading(true);
    try {
      await verifyOtp(`91${profile.mobile}`, otp.trim());
      setForgotStep('reset');
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.toLowerCase().includes('expired')) {
        showAlert('Code expired', 'This OTP has expired. Tap Resend to get a new one.');
      } else {
        showAlert('Incorrect code', 'The OTP you entered is incorrect. Please enter correct OTP.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (password.length < 6) {
      showAlert('Password too short', 'Your new password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Passwords do not match', 'Please make sure both passwords are the same.');
      return;
    }
    const profile = await getUserProfile();
    if (!profile) return;
    setLoading(true);
    try {
      const result = await organiserResetPassword(profile.mobile, password);
      if (result.error) {
        showAlert('Error', result.error);
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

  function resetFields() {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  }

  if (mode === 'checking') {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.accent} />
      </SafeAreaView>
    );
  }

  const title = mode === 'setup' ? 'Set Up As Organiser'
    : mode === 'forgot' ? 'Reset Password'
    : 'Organiser Login';

  function handleSubmit() {
    if (mode === 'setup') handleSetup();
    else if (mode === 'login') handleLogin();
  }

  const btnLabel = loading ? 'Please wait…'
    : mode === 'setup' ? 'Create Account'
    : 'Continue →';

  if (mode === 'forgot') {
    const forgotTitle = forgotStep === 'send' ? 'Verify Identity'
      : forgotStep === 'verify' ? 'Enter OTP'
      : 'Set New Password';
    const forgotSubtitle = forgotStep === 'send'
      ? "We'll send a one-time code to your registered WhatsApp number to verify it's you."
      : forgotStep === 'verify'
      ? 'Enter the 6-digit code sent to your WhatsApp number.'
      : 'Choose a new password for your organiser account.';

    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => { resetFields(); setForgotStep('send'); setOtp(''); setMode('login'); }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{forgotTitle}</Text>
            <Text style={styles.subtitle}>{forgotSubtitle}</Text>

            {forgotStep === 'send' && (
              <TouchableOpacity
                style={[styles.btn, loading && { opacity: 0.5 }]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                <Text style={styles.btnText}>{loading ? 'Sending…' : 'Send OTP →'}</Text>
              </TouchableOpacity>
            )}

            {forgotStep === 'verify' && (
              <>
                <Text style={styles.label}>VERIFICATION CODE</Text>
                <TextInput
                  style={styles.input}
                  value={otp}
                  onChangeText={setOtp}
                  placeholder="6-digit code"
                  placeholderTextColor="#555"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.btn, loading && { opacity: 0.5 }]}
                  onPress={handleVerifyOtp}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? 'Verifying…' : 'Verify →'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.forgotBtn} onPress={() => { setOtp(''); setForgotStep('send'); }}>
                  <Text style={styles.forgotText}>Resend OTP</Text>
                </TouchableOpacity>
              </>
            )}

            {forgotStep === 'reset' && (
              <>
                <Text style={styles.label}>NEW PASSWORD</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    placeholder="Create a new password"
                    placeholderTextColor="#555"
                    autoFocus
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
                    <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.label}>CONFIRM PASSWORD</Text>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  placeholder="Re-enter your password"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.btn, loading && { opacity: 0.5 }]}
                  onPress={handleReset}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? 'Saving…' : 'Reset Password →'}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        {alertOverlay}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {mode === 'setup'
              ? "Create a password to protect your organiser account. You'll use this every time you manage your events."
              : 'Enter your organiser password to access your events.'}
          </Text>

          <Text style={styles.label}>PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder={mode === 'login' ? 'Enter your password' : 'Create a password'}
              placeholderTextColor="#555"
              autoFocus
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {mode === 'setup' && (
            <>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                placeholder="Re-enter your password"
                placeholderTextColor="#555"
                autoCapitalize="none"
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.btnText}>{btnLabel}</Text>
          </TouchableOpacity>

          {mode === 'login' && (
            <TouchableOpacity style={styles.forgotBtn} onPress={() => { resetFields(); setForgotStep('send'); setOtp(''); setMode('forgot'); }}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
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
    autoCapitalize: 'none',
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
  forgotBtn: { alignItems: 'center', marginTop: 20 },
  forgotText: { fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
});
