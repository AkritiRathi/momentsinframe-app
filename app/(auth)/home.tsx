import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { getUserProfile, UserProfile } from '../../lib/storage';
import { Colors } from '../../constants/colors';

export default function HomeScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    getUserProfile().then(setProfile);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.heading}>
          Hello, <Text style={styles.accent}>{profile?.firstName ?? '...'}</Text> 👋
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>WHAT WOULD YOU LIKE TO DO?</Text>

        <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push('/(auth)/join-event')}>
          <View style={[styles.iconWrap, styles.iconPrimary]}>
            <Text style={styles.iconText}>📷</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleDark}>Join An Event</Text>
            <Text style={styles.cardDescDark}>Scan a QR code or enter an event code to view and share photos.</Text>
          </View>
          <Text style={styles.arrowDark}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cardSecondary} onPress={() => router.push('/(auth)/event-admin-login')}>
          <View style={[styles.iconWrap, styles.iconSecondary]}>
            <Text style={styles.iconText}>🔐</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitleLight}>Event Admin Login</Text>
            <Text style={styles.cardDescLight}>Manage an existing event with your event admin password.</Text>
          </View>
          <Text style={styles.arrowLight}>›</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.masterLink} onPress={() => router.push('/(auth)/master-admin-login')}>
        <Text style={styles.masterLinkText}>Master admin →</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 0 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
  },
  greeting: { fontSize: 12, color: Colors.textMuted, marginBottom: 2 },
  heading: { fontSize: 22, fontWeight: '800', color: Colors.white },
  accent: { color: Colors.accent },
  body: { flex: 1, padding: 24 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 1, marginBottom: 16 },
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
  masterLink: {
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 0.5,
    borderTopColor: '#1A1A1A',
  },
  masterLinkText: { fontSize: 15, color: '#666', fontWeight: '600' },
});
