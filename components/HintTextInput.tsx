import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';

// ⭐ UNIVERSAL TEXT BOX WITH A HINT (2026-10-30, the user's yes).
// The grey hint is drawn by the APP as ordinary text laid over the empty box,
// NOT handed to the phone as a `placeholder`. Why: on iPhone the native hint
// is drawn once, and if that happens while a panel is still sliding in, it is
// laid out against the wrong width and stays spread out ("S e a r c h …")
// until the panel is reopened. App text is re-measured whenever the box
// changes size, so it cannot get stuck. Same code on iPhone and Android.
// History: memory feedback_ios_modal_safe_area.md ("THE STRETCHED PLACEHOLDER
// IS A RACE"). ⛔ Do not pass `placeholder` through to the TextInput.

export type HintTextInputProps = Omit<TextInputProps, 'placeholder' | 'placeholderTextColor'> & {
  hint: string;
  hintColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

const HintTextInput = forwardRef<TextInput, HintTextInputProps>(function HintTextInput(
  { hint, hintColor = '#555', containerStyle, style, value, defaultValue, onChangeText, accessibilityLabel, ...rest },
  ref,
) {
  // Works for controlled boxes (value given) and uncontrolled ones alike.
  const [ownText, setOwnText] = useState(defaultValue ?? '');
  const text = value ?? ownText;

  // The hint copies the box's own padding and font, so it sits exactly where
  // the phone's hint used to.
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const pad = (side: unknown, axis: unknown) =>
    (typeof side === 'number' ? side : typeof axis === 'number' ? axis : typeof flat.padding === 'number' ? flat.padding : 0);
  const border = typeof flat.borderWidth === 'number' ? flat.borderWidth : 0;
  const left = pad(flat.paddingLeft, flat.paddingHorizontal) + border;
  const right = pad(flat.paddingRight, flat.paddingHorizontal) + border;

  return (
    <View style={containerStyle}>
      <TextInput
        ref={ref}
        {...rest}
        style={style}
        value={value}
        defaultValue={defaultValue}
        onChangeText={t => { setOwnText(t); onChangeText?.(t); }}
        // Screen readers still announce what the box is for.
        accessibilityLabel={accessibilityLabel ?? hint}
      />
      {text === '' && (
        <View pointerEvents="none" style={[styles.hintLayer, { left, right }]}>
          <Text
            numberOfLines={1}
            style={[
              styles.hint,
              { color: hintColor, fontSize: flat.fontSize, fontFamily: flat.fontFamily, fontWeight: flat.fontWeight },
            ]}
          >
            {hint}
          </Text>
        </View>
      )}
    </View>
  );
});

export default HintTextInput;

const styles = StyleSheet.create({
  hintLayer: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  hint: { includeFontPadding: false },
});
