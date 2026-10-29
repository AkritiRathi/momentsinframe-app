import { StyleSheet, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import HintTextInput from './HintTextInput';
import { Colors } from '../constants/colors';

// ⭐ THE ONE SEARCH BOX (2026-10-30, the user's yes) — every search box in the
// app uses this, on iPhone and Android. Its hint is drawn by the app, never by
// the phone (see HintTextInput). ⛔ Do not add a search box with a raw
// TextInput `placeholder`: the memory audit fails if one appears
// (reference_memory_forensics.py, "search boxes use the shared SearchBox").
// The website has no search box yet; when it needs one, it gets a matching
// web SearchBox with the same look and behaviour (universal = iOS, Android, web).

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  hint?: string;
  // Optional per-screen look; the default is the Manage Event look.
  inputStyle?: StyleProp<TextStyle>;
  wrapStyle?: StyleProp<ViewStyle>;
};

export default function SearchBox({ value, onChangeText, hint = 'Search by name or number', inputStyle, wrapStyle }: Props) {
  return (
    <View style={wrapStyle ?? styles.wrap}>
      <HintTextInput
        style={inputStyle ?? styles.input}
        value={value}
        onChangeText={onChangeText}
        hint={hint}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  input: { backgroundColor: '#1E1E1E', borderRadius: 8, padding: 10, fontSize: 14, color: Colors.white, borderWidth: 0.5, borderColor: '#333' },
});
