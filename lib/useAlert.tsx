import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

type AlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type AlertConfig = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

export function useAlert() {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  function showAlert(title: string, message?: string, buttons: AlertButton[] = [{ text: 'OK' }]) {
    setConfig({ title, message, buttons });
  }

  const alertOverlay = config ? (() => {
    const primaryIdx = config.buttons.findIndex(b => b.style !== 'cancel' && b.style !== 'destructive');
    return (
      <View style={alertStyles.overlay}>
        <View style={alertStyles.card}>
          <Text style={alertStyles.title}>{config.title}</Text>
          {config.message ? <Text style={alertStyles.message}>{config.message}</Text> : null}
          <View style={alertStyles.buttons}>
            {config.buttons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  alertStyles.btn,
                  i === primaryIdx && alertStyles.btnPrimary,
                  btn.style === 'destructive' && alertStyles.btnDestructive,
                  btn.style === 'cancel' && alertStyles.btnCancel,
                ]}
                onPress={() => { setConfig(null); btn.onPress?.(); }}
              >
                <Text style={[
                  alertStyles.btnText,
                  i === primaryIdx && alertStyles.btnPrimaryText,
                  btn.style === 'cancel' && alertStyles.btnCancelText,
                  btn.style === 'destructive' && alertStyles.btnDestructiveText,
                ]}>
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  })() : null;

  return { showAlert, alertOverlay };
}

export const alertStyles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 300, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  card: { width: '100%', backgroundColor: '#1c1c1e', borderRadius: 16, padding: 24, borderWidth: 0.5, borderColor: '#333' },
  title: { fontSize: 18, fontWeight: '600', color: Colors.white, textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 15, color: Colors.textMuted, lineHeight: 21, textAlign: 'center', marginBottom: 16 },
  buttons: { gap: 8 },
  btn: { backgroundColor: '#2a2a2a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#3a3a3a' },
  btnPrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  btnCancel: { backgroundColor: 'transparent', borderColor: '#2a2a2a' },
  btnDestructive: { backgroundColor: '#2a2a2a', borderColor: 'rgba(229,57,53,0.6)', borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: '600', color: Colors.white },
  btnPrimaryText: { color: Colors.background },
  btnCancelText: { color: Colors.textMuted, fontWeight: '400' },
  btnDestructiveText: { color: Colors.danger, fontWeight: '700' },
});
