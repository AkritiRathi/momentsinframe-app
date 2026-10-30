import { StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { Colors } from '../constants/colors';

// ⭐ THE ONE WAY THE APP DESCRIBES A PERSON IN A LIST (the user, 2026-10-31:
// "I want the display of the name in the Allowed Guests to be the same as in
// Manage Guests"). Three lines, always in this order:
//   1. the name they signed in with (bold) · N photos
//   2. the name saved in THIS phone's contacts, or "Number not in contacts"
//   3. their number, then "· BLOCKED" when blocked
// Used by Manage Guests, Allowed Guests, the Admins panel and the Add Admin
// picker, so the lists cannot describe the same person differently again
// (Allowed Guests and the Admins panel had lines 1 and 2 swapped).
// Dimmed means exactly one thing: blocked.

type Props = {
  name: string;
  contactName?: string | null;
  phone: string;
  /** Leave out to show no photo count. */
  photoCount?: number | null;
  blocked?: boolean;
  /** Optional overrides, for a list with its own sizes (the Add Admin picker). */
  nameStyle?: StyleProp<TextStyle>;
  subStyle?: StyleProp<TextStyle>;
};

export function PersonLines({ name, contactName, phone, photoCount, blocked, nameStyle, subStyle }: Props) {
  const nameText = <Text style={[styles.name, nameStyle, blocked && styles.blocked]}>{name}</Text>;
  return (
    <>
      {photoCount != null ? (
        <View style={styles.line}>
          {nameText}
          <Text style={[styles.sub, { marginLeft: 6 }, subStyle, blocked && styles.blocked]}>· {photoCount} photos</Text>
        </View>
      ) : nameText}
      <Text style={[styles.sub, subStyle, blocked && styles.blocked]}>{contactName || 'Number not in contacts'}</Text>
      <View style={styles.line}>
        <Text style={[styles.sub, subStyle, blocked && styles.blocked]}>{phone}</Text>
        {blocked && <Text style={[styles.badge, { marginLeft: 6 }]}>· BLOCKED</Text>}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: Colors.white },
  sub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  blocked: { color: Colors.textMuted },
  badge: { fontSize: 10, fontWeight: '800', color: '#E53935' },
});
