import type { ReactNode } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PhotoViewer from './PhotoViewer';
import { Colors } from '../constants/colors';

// ⭐ THE ONE FULL-SCREEN PHOTO (2026-11-08, the user: "Is it not better to make
// a universal code for all the lightbox in the 3 screens …" + "the Recycle bin
// full screen … should also come under this, just with what buttons should be
// different and the display text"). Used by the Event screen, Guest Uploads,
// Find My Photos and the Recycle bin. Memory: project_universal_lightbox.md.
//
// One top bar (counter · the screen's buttons · ×), the shared PhotoViewer
// (protected item 5 — untouched), the bottom text, and the busy covers. Each
// screen passes only what really differs:
//  - Event / Guest Uploads / Find My Photos: Delete (shown ONLY when that
//    photo may be deleted, hidden otherwise — the user, 2026-11-08: "follow
//    the Event") · Download · Share, and "Uploaded by / Taken on".
//  - Recycle bin: no top buttons; its own two lines and Restore / Delete
//    permanently row (decided 2026-11-01) as `footer`.
// While busy every button is greyed and the gestures stop (busy → PhotoViewer).

export type LightboxBusy = null | 'download' | 'share' | 'delete' | 'restore';

type Props<T> = {
  visible: boolean;
  onClose: () => void;
  items: T[];
  index: number;
  onIndexChange: (i: number) => void;
  getKey: (p: T) => string;
  getUri: (p: T) => string | null;
  onLoadingChange?: (loading: boolean) => void;
  busy: LightboxBusy;
  /** Top buttons of the photo screens. Omit for the Recycle bin. */
  actions?: { canDelete: boolean; onDelete: () => void; onDownload: () => void; onShare: () => void };
  /** The photo screens' standard bottom text. */
  caption?: { uploadedBy?: string | null; takenAt?: string | null };
  /** A screen's own bottom area instead of `caption` (the Recycle bin). */
  footer?: ReactNode;
  /** Drawn last, inside the Modal (alerts, permission prompts) so they are not hidden behind it. */
  overlays?: ReactNode;
};

export default function PhotoLightbox<T>(p: Props<T>) {
  const insets = useSafeAreaInsets();
  const busy = p.busy;
  const covering = busy === 'download' || busy === 'share';
  const coverClose = (
    <TouchableOpacity
      style={[styles.btn, styles.close, styles.closeOnCover, { top: insets.top + 12 }]}
      onPress={p.onClose}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.closeText}>×</Text>
    </TouchableOpacity>
  );
  return (
    <Modal visible={p.visible} animationType="fade" onRequestClose={p.onClose}>
      <GestureHandlerRootView style={styles.inner}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.counter}>{p.items.length > 0 ? `${Math.min(p.index, p.items.length - 1) + 1} / ${p.items.length}` : ''}</Text>
          {p.actions && (
            <View style={styles.actions}>
              {p.actions.canDelete && (
                <TouchableOpacity style={[styles.btn, styles.btnDanger, !!busy && { opacity: 0.4 }]} disabled={!!busy} onPress={p.actions.onDelete}>
                  <Text style={[styles.btnText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.btn, !!busy && { opacity: 0.4 }]} disabled={!!busy} onPress={p.actions.onDownload}>
                <Text style={styles.btnText}>Download</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, !!busy && { opacity: 0.4 }]} disabled={!!busy} onPress={p.actions.onShare}>
                <Text style={styles.btnText}>Share</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Close. A normal item in the row, NOT positioned by hand: the same
              centring that lines up the buttons lines this up too, on every
              device (event.tsx history, 2026-10-10). */}
          <TouchableOpacity
            style={[styles.btn, styles.close, covering && { opacity: 0 }]}
            onPress={p.onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.closeText}>×</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.imgWrap, { overflow: 'hidden' }]}>
          {p.items.length > 0 && (
            <PhotoViewer
              items={p.items}
              index={Math.min(p.index, p.items.length - 1)}
              getKey={p.getKey}
              getUri={p.getUri}
              onIndexChange={p.onIndexChange}
              onClose={p.onClose}
              busy={!!busy}
              onLoadingChange={p.onLoadingChange}
            />
          )}
          {(busy === 'delete' || busy === 'restore') && (
            <View style={styles.photoCover}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={styles.photoCoverText}>{busy === 'restore' ? 'Restoring…' : 'Deleting...'}</Text>
            </View>
          )}
          {/* ‹ › arrows: drawn by the shared PhotoViewer (2026-11-05). */}
        </View>
        {p.footer ?? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            {!!p.caption?.uploadedBy && (
              <Text style={styles.footerLine1}>Uploaded by {p.caption.uploadedBy}</Text>
            )}
            {!!p.caption?.takenAt && (
              <Text style={styles.footerLine2}>
                {'Taken on '}{new Date(p.caption.takenAt).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                })}
              </Text>
            )}
          </View>
        )}
        {covering && (
          <View style={styles.cover}>
            <ActivityIndicator color={Colors.white} size="large" />
            <Text style={styles.coverText}>{busy === 'share' ? 'Preparing…' : 'Downloading…'}</Text>
            {coverClose}
          </View>
        )}
        {p.overlays}
      </GestureHandlerRootView>
    </Modal>
  );
}

// The look of the Event screen's full-screen photo (event.tsx lb* styles,
// with their reasons) — now the one look for all four screens.
const styles = StyleSheet.create({
  inner: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  counter: { fontSize: 13, color: '#666', flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 },
  btnDanger: { borderColor: 'rgba(229,57,53,0.3)' },
  // lineHeight pinned so every chip is 31 tall on both platforms.
  btnText: { fontSize: 13, fontWeight: '500', color: '#888', lineHeight: 18 },
  // The close is BUILT FROM btn, so it can never drift from the others: 31 tall.
  close: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 2 },
  closeOnCover: { position: 'absolute', right: 16, marginLeft: 0 },
  // lineHeight = fontSize + includeFontPadding:false keep the × optically centred.
  closeText: { fontSize: 26, lineHeight: 26, color: '#888', includeFontPadding: false, textAlign: 'center' },
  imgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  photoCover: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  photoCoverText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  footerLine1: { fontSize: 13, color: '#ccc', marginBottom: 2 },
  footerLine2: { fontSize: 12, color: '#888' },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10, justifyContent: 'center', alignItems: 'center', gap: 12 },
  coverText: { color: Colors.white, fontSize: 14, fontWeight: '500' },
});
