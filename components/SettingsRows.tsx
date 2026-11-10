// ⭐ SETTINGS ROWS — the ONE look for every options / settings list in the app
// (2026-11-10, the user: "What I want from the Universal code is that when I
// add more rows to the My Settings that it will match the Home Screen rows",
// "when I say universal code I mean the font also"). Memory:
// project_universal_code.md, 2026-11-10.
//
// ⛔ THE HOME SCREEN ROWS ARE THE MASTER LOOK. Every size, colour, corner,
// spacing AND font (size, weight, colour) lives HERE, never on a screen. A new
// row anywhere = one of these pieces, so it always matches Home.
// The website has the matching piece: onealbum-trial src/components/SettingsRows.tsx
// — change both together.
//
// Pieces:
//   NavRow       — a name and ›            (Your Details, Event Settings, Find My Photos)
//   ExpandRow    — a name and a turning ›; lines slide open under it
//   SubRow       — a line inside ExpandRow, ending in › or a gold ✓
//   SwitchRow    — a name with ⓘ (tap → explanation slides open), a status
//                  line, a switch; optional extra lines and a footer row
//   CardFooterRow — a gold row under a divider inside a SwitchRow (Allowed Guests (n))
//   SettingsHeader — ← and a centred title, for a settings page
//   SETTINGS_PAGE_MARGIN — the side margin of a settings page (24, as Home)

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, LayoutAnimation,
  Switch, ActivityIndicator, StyleProp, ViewStyle,
} from 'react-native';
import { Colors } from '../constants/colors';

export const SETTINGS_PAGE_MARGIN = 24;

export function NavRow({ label, onPress, style, disabled }: {
  label: string; onPress: () => void; style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={[rowStyles.navRow, disabled && { opacity: 0.4 }, style]} onPress={onPress} disabled={disabled}>
      <Text style={rowStyles.rowText}>{label}</Text>
      <Text style={rowStyles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

// The › turns down when open and back when closed — also when the screen
// closes it (e.g. reset each time a page opens).
export function ExpandRow({ label, open, onToggle, children, style }: {
  label: string; open: boolean; onToggle: () => void; children?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open, turn]);
  return (
    <View style={[rowStyles.group, style]}>
      <TouchableOpacity style={rowStyles.groupInner} onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onToggle();
      }}>
        <Text style={rowStyles.rowText}>{label}</Text>
        <Animated.Text style={[rowStyles.arrow, { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '-90deg'] }) }] }]}>›</Animated.Text>
      </TouchableOpacity>
      {open && children}
    </View>
  );
}

export function SubRow({ label, onPress, mark = 'chevron' }: {
  label: string; onPress: () => void; mark?: 'chevron' | 'tick' | 'none';
}) {
  return (
    <TouchableOpacity style={rowStyles.subRow} onPress={onPress}>
      <Text style={rowStyles.subRowText}>{label}</Text>
      {mark === 'chevron' && <Text style={rowStyles.arrow}>›</Text>}
      {mark === 'tick' && <Text style={rowStyles.tick}>✓</Text>}
    </TouchableOpacity>
  );
}

// A setting with a switch (Event Settings). Same card, name font and colours
// as the rows above. Tapping the name (with ⓘ) opens / closes the explanation.
export function SwitchRow({
  label, info, infoNode, infoOpen, onInfoPress, status, extra,
  value, onValueChange, disabled, busy, footer,
}: {
  label: string; info?: string; infoOpen?: boolean; onInfoPress?: () => void;
  // Shown instead of `info` when the name is tapped (e.g. the Album event's
  // bullets, 2026-11-11 — the user: closed by default, opens on the name).
  infoNode?: React.ReactNode;
  status?: string; extra?: React.ReactNode;
  value: boolean; onValueChange?: (v: boolean) => void; disabled?: boolean; busy?: boolean;
  footer?: React.ReactNode;
}) {
  const hasInfo = !!info || !!infoNode;
  return (
    <View style={[rowStyles.switchCard, footer ? rowStyles.switchCardColumn : null]}>
      <View style={rowStyles.switchTop}>
        <View style={rowStyles.switchInfo}>
          <TouchableOpacity onPress={onInfoPress} activeOpacity={0.7} disabled={!onInfoPress}>
            <Text style={rowStyles.rowText}>{label}{hasInfo ? <Text style={rowStyles.infoIcon}> ⓘ</Text> : null}</Text>
          </TouchableOpacity>
          {infoOpen && infoNode ? infoNode : infoOpen && info ? <Text style={rowStyles.infoText}>{info}</Text> : null}
          {status ? <Text style={rowStyles.status}>{status}</Text> : null}
          {extra}
        </View>
        {busy
          ? <ActivityIndicator color={Colors.accent} />
          : <Switch
              value={value}
              onValueChange={onValueChange}
              disabled={disabled}
              trackColor={{ false: '#333', true: Colors.accent }}
              thumbColor={Colors.white}
            />
        }
      </View>
      {footer}
    </View>
  );
}

export function CardFooterRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={rowStyles.footerRow} onPress={onPress}>
      <Text style={rowStyles.footerText}>{label}</Text>
      <Text style={[rowStyles.arrow, { color: Colors.accent }]}>›</Text>
    </TouchableOpacity>
  );
}

// A switch line inside a card's footer, under the same thin line as
// CardFooterRow — "Show all photos to everyone" under "Photographer's photos"
// (2026-11-11, the user: "like the Allowed Guests for Invite only event").
export function CardFooterSwitch({ label, status, value, onValueChange, busy }: {
  label: string; status?: string; value: boolean; onValueChange?: (v: boolean) => void; busy?: boolean;
}) {
  return (
    <View style={rowStyles.footerRow}>
      <View style={rowStyles.switchInfo}>
        <Text style={rowStyles.footerText}>{label}</Text>
        {status ? <Text style={rowStyles.status}>{status}</Text> : null}
      </View>
      {busy
        ? <ActivityIndicator color={Colors.accent} />
        : <Switch
            value={value}
            onValueChange={onValueChange}
            trackColor={{ false: '#333', true: Colors.accent }}
            thumbColor={Colors.white}
          />
      }
    </View>
  );
}

export function SettingsHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={rowStyles.header}>
      <TouchableOpacity onPress={onBack} style={{ width: 40 }}>
        <Text style={rowStyles.headerBack}>←</Text>
      </TouchableOpacity>
      <Text style={rowStyles.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

// Bulleted, justified lines — the Album event explanation (2026-11-11, the
// user: "justified with bullet points"). `size` 'small' = under a switch,
// 'large' = inside a pop-up box.
export function BulletLines({ lines, size = 'small' }: { lines: string[]; size?: 'small' | 'large' }) {
  const text = size === 'large' ? rowStyles.bulletTextLarge : rowStyles.bulletText;
  return (
    <View style={{ marginTop: 4 }}>
      {lines.map((l, i) => (
        <View key={i} style={rowStyles.bulletRow}>
          <Text style={text}>•</Text>
          <Text style={[text, rowStyles.bulletBody]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

// Values taken from Home (app/(auth)/home.tsx navRow / navRowGroup /
// navRowInner / subRow, 2026-11-07) and, for the switch card, from Event
// Settings (event-detail.tsx settingRow, 2026-11-06) with Home's name font.
export const rowStyles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1A1A', borderWidth: 0.5, borderColor: '#2A2A2A', borderRadius: 8, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 8 },
  group: { backgroundColor: '#1A1A1A', borderWidth: 0.5, borderColor: '#2A2A2A', borderRadius: 8, marginBottom: 8, overflow: 'hidden' },
  groupInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: '#333', paddingVertical: 12, paddingLeft: 24, paddingRight: 12 },
  rowText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  subRowText: { fontSize: 14, fontWeight: '600', color: Colors.white },
  arrow: { fontSize: 22, color: Colors.textMuted },
  tick: { fontSize: 16, fontWeight: '700', color: Colors.accent },
  switchCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#2A2A2A' },
  switchCardColumn: { flexDirection: 'column', alignItems: 'stretch' },
  switchTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchInfo: { flex: 1, marginRight: 12 },
  infoIcon: { fontSize: 13, fontWeight: '400', color: Colors.textMuted },
  infoText: { fontSize: 13, color: '#BBB', lineHeight: 19, marginTop: 6, marginBottom: 4, textAlign: 'justify' },
  status: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  extraLine: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: '#333', marginTop: 12, paddingTop: 10 },
  footerText: { fontSize: 14, fontWeight: '700', color: Colors.accent },
  bulletRow: { flexDirection: 'row', marginTop: 2 },
  bulletBody: { flex: 1, paddingLeft: 6, textAlign: 'justify' },
  bulletText: { fontSize: 12, lineHeight: 17, color: Colors.textMuted },
  bulletTextLarge: { fontSize: 13, lineHeight: 20, color: '#BBB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  headerBack: { fontSize: 24, color: Colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
