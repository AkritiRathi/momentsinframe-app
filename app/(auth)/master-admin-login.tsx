import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { masterLogin } from '../../lib/api';
import { saveMasterSession } from '../../lib/auth';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { useAlert } from '../../lib/useAlert';

export default function MasterAdminLoginScreen() {
  const router = useRouter();
  const { showAlert, alertOverlay } = useAlert();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!password.trim()) {
      showAlert('Missing password', 'Please enter the master password.');
      return;
    }

    setLoading(true);
    try {
      const result = await masterLogin(password.trim());
      if (result.error) {
        showAlert('Login failed', result.error);
        return;
      }
      await saveMasterSession(password.trim());
      router.replace('/(master)/dashboard');
    } catch {
      showAlert('Error', 'Something went wrong. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>🔒</Text>
          </View>

          <Text style={styles.title}>Master admin login</Text>
          <Text style={styles.subtitle}>Enter your master password to access all events and create new ones.</Text>

          <Text style={styles.label}>MASTER PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder="Enter master password"
              placeholderTextColor="#333"
              autoCapitalize="none"
              autoFocus
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>This password gives access to all events.</Text>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
            <Text style={styles.loginButtonText}>{loading ? 'Logging in...' : 'Login →'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { padding: 24, paddingTop: 20 },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: Colors.card,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { fontSize: 28 },
  title: { ...Typography.heading, color: Colors.white, marginBottom: 8 },
  subtitle: { ...Typography.body, color: Colors.textMuted, marginBottom: 28 },
  label: { ...Typography.inputLabel, color: Colors.accent, marginBottom: 8 },
  passwordRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  passwordInput: { flex: 1, padding: 14, fontSize: 15, color: Colors.white },
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
