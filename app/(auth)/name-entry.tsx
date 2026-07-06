import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { saveUserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function NameEntryScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGetStarted() {
    if (!firstName.trim() || !lastName.trim() || !mobile.trim()) {
      showAlert('Missing details', 'Please fill in all fields to continue.');
      return;
    }
    if (!/^\d{10}$/.test(mobile.trim())) {
      showAlert('Invalid number', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    showAlert(
      'Are you sure?',
      'Details once entered cannot be changed. Please confirm your details are correct.',
      [
        {
          text: 'Confirm',
          onPress: async () => {
            setLoading(true);
            await saveUserProfile({ firstName: firstName.trim(), lastName: lastName.trim(), mobile: mobile.trim() });
            router.replace('/(auth)/home');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

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
          <Text style={styles.warning}>Details once entered cannot be changed.</Text>

          <View style={styles.form}>
            <Text style={styles.label}>FIRST NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor="#555"
              value={firstName}
              onChangeText={setFirstName}
              autoCorrect={false}
            />

            <Text style={styles.label}>LAST NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor="#555"
              value={lastName}
              onChangeText={setLastName}
              autoCorrect={false}
            />

            <Text style={styles.label}>MOBILE NUMBER</Text>
            <View style={styles.phoneRow}>
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
              />
            </View>

            <Text style={styles.mobileHint}>Your mobile number identifies your uploads so only you can delete photos you've added.</Text>

            <TouchableOpacity style={styles.button} onPress={handleGetStarted} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Get started →'}</Text>
            </TouchableOpacity>
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
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 36 },
  form: {},
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
  phoneRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
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
  mobileHint: { fontSize: 13, fontWeight: '700', color: Colors.accent, marginBottom: 16 },
  warning: { fontSize: 13, fontWeight: '700', color: Colors.accent, marginBottom: 24 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: { ...Typography.buttonText, color: Colors.background },
});
