import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { saveUserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';

export default function NameEntryScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGetStarted() {
    if (!firstName.trim() || !lastName.trim() || !mobile.trim()) {
      Alert.alert('Missing details', 'Please fill in all fields to continue.');
      return;
    }
    if (!/^\d{10}$/.test(mobile.trim())) {
      Alert.alert('Invalid number', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    await saveUserProfile({ firstName: firstName.trim(), lastName: lastName.trim(), mobile: mobile.trim() });
    router.replace('/(auth)/home');
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
          <Text style={styles.title}>Let's get{'\n'}started</Text>
          <Text style={styles.subtitle}>Tell us a little about yourself so we can personalise your experience.</Text>

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
                placeholder="10-digit mobile number"
                placeholderTextColor="#777"
                value={mobile}
                onChangeText={setMobile}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </View>

            <Text style={styles.hint}>Your details are saved to personalise your experience.</Text>

            <TouchableOpacity style={styles.button} onPress={handleGetStarted} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Get started →'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40 },
  appName: { fontSize: 13, fontWeight: '700', color: Colors.accent, letterSpacing: 1.5, marginBottom: 16, textTransform: 'uppercase' },
  title: { fontSize: 36, fontWeight: '800', color: Colors.white, lineHeight: 42, marginBottom: 10 },
  subtitle: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 36 },
  form: {},
  label: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 8 },
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
  hint: { fontSize: 12, color: Colors.textMuted, marginBottom: 28 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
