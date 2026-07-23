import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, StatusBar, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { saveUserProfile } from '../../lib/storage';
import { registerUser, lookupUsers, sendOtp, verifyOtp } from '../../lib/api';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

type Step = 'phone' | 'details';

export default function NameEntryScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();

  const [step, setStep] = useState<Step>('phone');
  const [mobile, setMobile] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [otp, setOtp] = useState('');
  const [isExisting, setIsExisting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (!/^\d{10}$/.test(mobile.trim())) {
      showAlert('Invalid number', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      const phone10 = mobile.trim();
      const phone91 = `91${phone10}`;

      const [lookupResult] = await Promise.all([
        lookupUsers([phone10]),
        sendOtp(phone91),
      ]);

      const existing = lookupResult.registered.includes(phone10);
      setIsExisting(existing);

      if (existing) {
        const userRecord = lookupResult.users.find(u => u.phone === phone10);
        if (userRecord?.name) {
          const parts = userRecord.name.split(' ');
          setFirstName(parts[0] ?? '');
          setLastName(parts.slice(1).join(' ') ?? '');
        }
      }

      setStep('details');
    } catch {
      showAlert('Error', 'Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!isExisting && (!firstName.trim() || !lastName.trim())) {
      showAlert('Missing details', 'Please enter your first and last name.');
      return;
    }
    if (otp.length !== 6) {
      showAlert('Invalid code', 'Please enter the 6-digit code sent to your WhatsApp.');
      return;
    }

    setSubmitting(true);
    try {
      await verifyOtp(`91${mobile.trim()}`, otp.trim());
    } catch {
      showAlert('Incorrect code', 'The code you entered is wrong or has expired. Tap Resend to get a new one.');
      setSubmitting(false);
      return;
    }

    try {
      const first = firstName.trim();
      const last = lastName.trim();
      const name = `${first} ${last}`;
      await saveUserProfile({ firstName: first, lastName: last, mobile: mobile.trim() });
      await registerUser(mobile.trim(), name).catch(() => {});
      router.replace('/(auth)/home');
    } catch {
      showAlert('Error', 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    try {
      await sendOtp(`91${mobile.trim()}`);
      showAlert('Sent', 'A new code has been sent to your WhatsApp.');
    } catch {
      showAlert('Error', 'Could not resend OTP. Please try again.');
    }
  }

  const isPhoneStep = step === 'phone';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.appName}>MomentsInFrame</Text>
          <Text style={styles.title}>Let's get started</Text>
          <Text style={styles.subtitle}>Tell us a little about yourself so we can personalise your experience.</Text>
          {!isExisting && <Text style={styles.warning}>Details once entered cannot be changed.</Text>}

          <View style={styles.form}>
            {/* Mobile number */}
            <Text style={styles.label}>MOBILE NUMBER</Text>
            <View style={[styles.phoneRow, !isPhoneStep && styles.disabled]}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>🇮🇳 +91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="10-digit WhatsApp number"
                placeholderTextColor="#777"
                value={mobile}
                onChangeText={setMobile}
                keyboardType="phone-pad"
                maxLength={10}
                editable={isPhoneStep}
              />
              {isPhoneStep && (
                <TouchableOpacity style={styles.goButton} onPress={handleContinue} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color={Colors.background} size="small" />
                    : <Text style={styles.goButtonText}>Go</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.mobileHint}>Your mobile number identifies your uploads so only you can delete photos you've added.</Text>

            {/* First name */}
            <Text style={[styles.label, isPhoneStep && styles.labelMuted]}>FIRST NAME</Text>
            <TextInput
              style={[styles.input, (isPhoneStep || isExisting) && styles.inputDisabled]}
              placeholder="First name"
              placeholderTextColor="#555"
              value={firstName}
              onChangeText={setFirstName}
              autoCorrect={false}
              editable={!isPhoneStep && !isExisting}
            />

            {/* Last name */}
            <Text style={[styles.label, isPhoneStep && styles.labelMuted]}>LAST NAME</Text>
            <TextInput
              style={[styles.input, (isPhoneStep || isExisting) && styles.inputDisabled]}
              placeholder="Last name"
              placeholderTextColor="#555"
              value={lastName}
              onChangeText={setLastName}
              autoCorrect={false}
              editable={!isPhoneStep && !isExisting}
            />

            {/* OTP */}
            {!isPhoneStep && (
              <>
                <Text style={styles.label}>VERIFICATION CODE</Text>
                <TextInput
                  style={styles.input}
                  placeholder="6-digit code from WhatsApp"
                  placeholderTextColor="#555"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TouchableOpacity onPress={handleResend} style={styles.resendRow}>
                  <Text style={styles.resendText}>Didn't receive it? Resend →</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Button — only shown after Go is pressed */}
            {!isPhoneStep && (
              <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
                {submitting
                  ? <ActivityIndicator color={Colors.background} />
                  : <Text style={styles.buttonText}>{isExisting ? 'Enter →' : 'Get started →'}</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {alertOverlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40 },
  appName: { fontSize: 13, fontWeight: '700', color: Colors.accent, letterSpacing: 1.5, marginBottom: 16, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '800', color: Colors.white, lineHeight: 36, marginBottom: 10 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 16 },
  warning: { fontSize: 13, fontWeight: '700', color: Colors.accent, marginBottom: 24 },
  form: { marginTop: 8 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8 },
  labelMuted: { opacity: 0.35 },
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
  inputDisabled: { opacity: 0.35 },
  disabled: { opacity: 0.35 },
  phoneRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  countryCode: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  countryCodeText: { fontSize: 15, color: Colors.white },
  phoneInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
  },
  mobileHint: { fontSize: 13, fontWeight: '700', color: Colors.accent, marginBottom: 20 },
  resendRow: { alignItems: 'flex-end', marginTop: -12, marginBottom: 20 },
  resendText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { ...Typography.buttonText, color: Colors.background },
  goButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 48,
  },
  goButtonText: { ...Typography.buttonText, color: Colors.background, fontSize: 15 },
});
