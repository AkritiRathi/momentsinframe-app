import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import { Colors } from '../constants/colors';

type AlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type AlertConfig = {
  title: string;
  message?: string;
  detail?: string;
  buttons: AlertButton[];
  rowButtons?: boolean;
};

export function useAlert() {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  useEffect(() => {
    if (!config) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [config]);

  function showAlert(title: string, message?: string, buttons: AlertButton[] = [{ text: 'OK' }], detail?: string, rowButtons?: boolean) {
    setConfig({ title, message, detail, buttons, rowButtons });
  }

  const alertOverlay = config ? (() => {
    const primaryIdx = config.buttons.findIndex(b => b.style !== 'cancel' && b.style !== 'destructive');
    const cancelBtns = config.rowButtons ? config.buttons.filter(b => b.style === 'cancel') : [];
    const actionBtns = config.rowButtons ? config.buttons.filter(b => b.style !== 'cancel') : config.buttons;

    const renderBtn = (btn: AlertButton, i: number, globalIdx: number) => (
      <TouchableOpacity
        key={i}
        style={[
          alertStyles.btn,
          globalIdx === primaryIdx && alertStyles.btnPrimary,
          btn.style === 'destructive' && alertStyles.btnDestructive,
          btn.style === 'cancel' && alertStyles.btnCancel,
        ]}
        onPress={() => { setConfig(null); btn.onPress?.(); }}
      >
        <Text style={[
          alertStyles.btnText,
          globalIdx === primaryIdx && alertStyles.btnPrimaryText,
          btn.style === 'cancel' && alertStyles.btnCancelText,
          btn.style === 'destructive' && alertStyles.btnDestructiveText,
        ]}>
          {btn.text}
        </Text>
      </TouchableOpacity>
    );

    return (
      <View style={alertStyles.overlay}>
        <View style={alertStyles.card}>
          <Text style={alertStyles.title}>{config.title}</Text>
          {config.message ? <Text style={alertStyles.message}>{config.message}</Text> : null}
          {config.detail ? (
            <View style={alertStyles.detailCard}>
              <Text style={alertStyles.detailText}>{config.detail}</Text>
            </View>
          ) : null}
          <View style={alertStyles.buttons}>
            {config.rowButtons ? (
              <>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {actionBtns.map((btn, i) => {
                    const globalIdx = config.buttons.indexOf(btn);
                    return <View key={i} style={{ flex: 1 }}>{renderBtn(btn, i, globalIdx)}</View>;
                  })}
                </View>
                {cancelBtns.map((btn, i) => {
                  const globalIdx = config.buttons.indexOf(btn);
                  return renderBtn(btn, i, globalIdx);
                })}
              </>
            ) : (
              config.buttons.map((btn, i) => renderBtn(btn, i, i))
            )}
          </View>
        </View>
      </View>
    );
  })() : null;

  return { showAlert, alertOverlay, isAlertVisible: config !== null };
}

export const alertStyles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 300, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  card: { width: '100%', backgroundColor: '#1c1c1e', borderRadius: 16, padding: 24, borderWidth: 0.5, borderColor: '#333' },
  title: { fontSize: 18, fontWeight: '600', color: Colors.white, textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 15, color: Colors.textMuted, lineHeight: 21, textAlign: 'left', marginBottom: 16 },
  buttons: { gap: 8 },
  btn: { backgroundColor: '#2a2a2a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#3a3a3a' },
  btnPrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  btnCancel: { backgroundColor: 'transparent', borderColor: '#2a2a2a' },
  btnDestructive: { backgroundColor: '#2a2a2a', borderColor: 'rgba(229,57,53,0.6)', borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: '600', color: Colors.white },
  btnPrimaryText: { color: Colors.background },
  btnCancelText: { color: Colors.textMuted, fontWeight: '400' },
  btnDestructiveText: { color: Colors.danger, fontWeight: '700' },
  detailCard: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 16 },
  detailText: { fontSize: 15, fontWeight: '600', color: Colors.white, textAlign: 'center', lineHeight: 22 },
});
