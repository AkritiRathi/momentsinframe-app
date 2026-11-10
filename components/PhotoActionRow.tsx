// ⭐ PHOTO-SCREEN BUTTON ROW — the ONE row of buttons above a photo grid
// (2026-11-10, the user's "Yes for both"): one outlined button at the FAR LEFT
// (red "Delete Photos", or gold "Search again") and the gold "Download Photos"
// at the FAR RIGHT. Used by the Event screen, Guest Uploads and Find My Photos.
// Look + font taken from the Event screen (the master screen, RULES D47:
// event.tsx selectPhotosRow / deleteModeBtn / selectPhotosBtn). The website has
// the matching piece: onealbum-trial src/components/PhotoActionRow.tsx.
// Memory: project_universal_code.md, 2026-11-10.
//
// A restricted button stays in place, greyed (0.4) — never hidden (RULES D53/D54).
// `dim` greys a button that still takes taps (the screen guards the tap itself).

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';

type Btn = { label: string; onPress: () => void; disabled?: boolean; dim?: boolean };

export default function PhotoActionRow({ left, leftKind = 'danger', right, style }: {
  left?: Btn; leftKind?: 'danger' | 'accent'; right?: Btn; style?: StyleProp<ViewStyle>;
}) {
  const leftColor = leftKind === 'danger' ? Colors.danger : Colors.accent;
  return (
    <View style={[s.row, style]}>
      {left && (
        <TouchableOpacity
          style={[s.outlineBtn, { borderColor: leftColor }, (left.disabled || left.dim) && { opacity: 0.4 }]}
          disabled={left.disabled}
          onPress={left.onPress}
        >
          <Text style={[s.btnText, { color: leftColor }]}>{left.label}</Text>
        </TouchableOpacity>
      )}
      {right && (
        <TouchableOpacity
          style={[s.fillBtn, (right.disabled || right.dim) && { opacity: 0.4 }]}
          disabled={right.disabled}
          onPress={right.onPress}
        >
          <Text style={[s.btnText, { color: Colors.background }]}>{right.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  outlineBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  // Same 1.5 border as the outlined button (in its own gold), so both are the
  // same height (2026-11-10, the user: the Download button looked smaller).
  fillBtn: { backgroundColor: Colors.accent, borderWidth: 1.5, borderColor: Colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 'auto' },
  btnText: { ...Typography.buttonText },
});
