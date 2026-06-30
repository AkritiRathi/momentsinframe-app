import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { changeMasterPassword } from '@/lib/api';
import { saveMasterSession, getMasterPassword } from '@/lib/auth';
import { Colors } from '@/constants/colors';

export default function ChangeMasterPasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleChange() {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (newPassword.trim().length < 6) {
      Alert.alert('Too short', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      Alert.alert('Mismatch', 'New password and confirm password do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await changeMasterPassword(currentPassword.trim(), newPassword.trim());
      if (result.error) {
        Alert.alert('Error', result.error);
        return;
      }
      // Update stored password in session
      await saveMasterSession(newPassword.trim());
      Alert.alert('Password changed', 'Your master password has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
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
          <Text style={styles.title}>Change master{'\n'}password</Text>
          <Text style={styles.subtitle}>Enter your current password and choose a new one.</Text>

          <Text style={styles.label}>CURRENT PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry={!showCurrent}
              placeholder="Current password"
              placeholderTextColor="#333"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowCurrent(!showCurrent)}>
              <Text>{showCurrent ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>NEW PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showNew}
              placeholder="New password (min. 6 chars)"
              placeholderTextColor="#333"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNew(!showNew)}>
              <Text>{showNew ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>CONFIRM NEW PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Repeat new password"
              placeholderTextColor="#333"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.saveBtn} onPress={handleChange} disabled={loading}>
            <Text style={styles.saveBtnText}>{loading ? 'Saving...' : 'Save new password →'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 24, color: Colors.textMuted },
  body: { padding: 24, paddingTop: 16 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.white, lineHeight: 32, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 28 },
  label: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 8 },
  passwordRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  passwordInput: { flex: 1, padding: 14, fontSize: 15, color: Colors.white },
  eyeBtn: { padding: 14 },
  divider: { height: 0.5, backgroundColor: '#222', marginBottom: 20 },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
