import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { joinEvent, eventAdminLogin } from '../../lib/api';
import { getLastAdminEventCode, saveLastAdminEventCode } from '../../lib/storage';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function EventAdminLoginScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getLastAdminEventCode().then(saved => { if (saved) setCode(saved); });
  }, []);

  async function handleLogin() {
    if (code.trim().length !== 6) {
      showAlert('Invalid code', 'Please enter the 6-digit event code.');
      return;
    }
    if (!password.trim()) {
      showAlert('Missing password', 'Please enter the event admin password.');
      return;
    }

    setLoading(true);
    try {
      // First resolve the event code to a slug
      const joinResult = await joinEvent(code.trim());
      if (joinResult.error) {
        showAlert('Event not found', joinResult.error);
        return;
      }

      const slug = joinResult.event.slug;
      const loginResult = await eventAdminLogin(slug, password.trim());

      if (loginResult.error) {
        showAlert('Login failed', loginResult.error);
        return;
      }

      await saveLastAdminEventCode(code.trim());
      router.replace({
        pathname: '/event',
        params: {
          slug: joinResult.event.slug,
          name: joinResult.event.name,
          expiresAt: joinResult.event.expires_at,
          createdAt: joinResult.event.created_at ?? new Date().toISOString(),
          isAdmin: 'true',
          adminPassword: password.trim(),
        },
      });
    } catch {
      showAlert('Error', 'Something went wrong. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          <View style={styles.body}>
            <Text style={styles.title}>Event Admin Login</Text>
            <Text style={styles.subtitle}>Enter the event code and your admin password to manage this event.</Text>

            <Text style={styles.label}>EVENT CODE</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="6-digit code"
              placeholderTextColor="#333"
              textAlign="center"
            />

            <Text style={styles.label}>EVENT ADMIN PASSWORD</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter password"
                placeholderTextColor="#333"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.hint}>Master admins can access any event with the master password.</Text>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
              <Text style={styles.loginButtonText}>{loading ? 'Logging in...' : 'Login →'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { padding: 24, paddingTop: 16 },
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 28 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8 },
  codeInput: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 22,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 8,
    marginBottom: 20,
  },
  passwordRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 15,
    color: Colors.white,
  },
  eyeBtn: { padding: 14 },
  eyeText: { fontSize: 18 },
  hint: { ...Typography.caption, color: '#444', marginBottom: 24 },
  divider: { height: 0.5, backgroundColor: '#222', marginBottom: 20 },
  loginButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  loginButtonText: { ...Typography.buttonText, color: Colors.background },
});
