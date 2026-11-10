import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, FlatList, Image, Modal,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors } from '../constants/colors';
import PhotoLightbox, { type LightboxBusy } from '../components/PhotoLightbox';
import { useAlert } from '../lib/useAlert';
import { getRecycleBin, recycleBinRestore, recycleBinDeletePermanently, RecycleBinPhoto } from '../lib/api';
import { markGalleryRestored } from '../lib/galleryRefresh';

// ⭐ THE RECYCLE BIN (2026-10-30, the user's yes; every rule decided
// 2026-10-27 — memory project_recently_deleted).
// - Shows ONLY the photos THIS person moved to the bin in this event (the
//   server decides that from the login token). 30 days, then gone for good.
// - The ONLY actions: Restore and Delete permanently — from the grid (select
//   one or many) or from the photo opened full-screen. NO Share and NO
//   Download ("If a user wants to share or download he/she can restore").
// - Delete permanently always asks first.
// - Restore can be refused: after the event expired (only the Organiser may
//   restore), or for a photo that is already back in the event.
// The full-screen view uses the ONE shared photo viewer (components/
// PhotoViewer.tsx, 2026-11-05, the user's "Yes"): slides with the finger,
// neighbours already loaded, full-size photo, zoom and swipe-down to close.
// Until 2026-11-05 it was this screen's own simple pager — the approved plan
// (2026-10-27) had said to copy the event screen's lightbox, which the pager
// did not (no zoom, no swipe-down): memory project_recently_deleted.

const DAY_MS = 24 * 60 * 60 * 1000;
const COLS = 3;

function daysLeftLabel(goneAt: string): string {
  const ms = new Date(goneAt).getTime() - Date.now();
  if (ms <= DAY_MS) return 'Less than a day';
  const days = Math.ceil(ms / DAY_MS);
  return `${days} days left`;
}

export default function RecycleBinScreen() {
  const params = useLocalSearchParams<{ slug: string; eventName?: string }>();
  const slug = params.slug;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();

  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<RecycleBinPhoto[]>([]);
  const [canRestore, setCanRestore] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Which action is running, for the full-screen cover ('Restoring…' / 'Deleting...') — 2026-11-08.
  const [busyKind, setBusyKind] = useState<LightboxBusy>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const screenW = Dimensions.get('window').width;
  const cell = Math.floor(screenW / COLS);

  // ⛔ LOADS ONCE PER EVENT (fixed 2026-10-30, the user: "its stuck showing
  // this"). The app's showAlert is a NEW function on every render (lib/useAlert
  // does not memoise it), so making the load depend on it re-ran the load after
  // every render — an endless loop that kept the spinner up for good. The
  // effect now depends on the event only; showAlert is read through a ref.
  const showAlertRef = useRef(showAlert);
  showAlertRef.current = showAlert;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRecycleBin(slug);
      if (data?.error) { showAlertRef.current('Error', data.error); return; }
      setPhotos(data?.photos ?? []);
      setCanRestore(data?.canRestore !== false);
    } catch {
      showAlertRef.current('Something went wrong', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // ⛔ After a photo leaves the full-screen view (Delete permanently or
  // Restore) the view shows the photo now at the same position — the next one
  // — or the previous one when the last was removed (the user, 2026-11-01: it
  // once went BLANK). removeFromList keeps that index; the shared viewer draws
  // whatever photo is at its index, so no extra scrolling is needed any more.
  // An empty bin closes the view and shows "Your Recycle bin is empty".

  const removeFromList = (ids: string[]) => {
    const gone = new Set(ids);
    setPhotos(prev => {
      const next = prev.filter(p => !gone.has(p.id));
      setViewerIndex(i => (i === null ? null : next.length === 0 ? null : Math.min(i, next.length - 1)));
      return next;
    });
    setSelected(new Set());
  };

  async function restore(ids: string[]) {
    if (ids.length === 0) return;
    if (!canRestore) {
      showAlert('Cannot restore', 'This event has expired. Only the Organiser can restore photos.');
      return;
    }
    setBusy(true);
    setBusyKind('restore');
    try {
      const result = await recycleBinRestore(slug, ids);
      const restored = result?.restored ?? [];
      const already = result?.alreadyInEvent ?? [];
      if (restored.length > 0) {
        markGalleryRestored(slug);
        removeFromList(restored);
      }
      if (result?.error) { showAlert('Error', result.error); return; }
      if (already.length > 0) {
        showAlert(
          'Already in the event',
          already.length === 1
            ? 'This photo is already in the event.'
            : `${already.length} photos are already in the event.`,
        );
      } else if (restored.length > 0 && viewerIndex === null) {
        setSelectMode(false);
      }
    } catch {
      showAlert('Something went wrong', 'Please try again.');
    } finally {
      setBusy(false);
      setBusyKind(null);
    }
  }

  function deletePermanently(ids: string[]) {
    if (ids.length === 0) return;
    showAlert(
      'Delete permanently?',
      'This cannot be undone.',
      [
        {
          text: 'Delete permanently', style: 'destructive', onPress: async () => {
            setBusy(true);
            setBusyKind('delete');
            try {
              const result = await recycleBinDeletePermanently(slug, ids);
              if (result?.error) { showAlert('Error', result.error); return; }
              removeFromList(result?.deleted ?? ids);
              if (viewerIndex === null) setSelectMode(false);
            } catch {
              showAlert('Something went wrong', 'Please try again.');
            } finally {
              setBusy(false);
              setBusyKind(null);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ⭐ READ-ONLY PHOTOS (2026-11-01, the user's yes): my uploads that the
  // Organiser or an Admin moved to the bin are shown with a tag, but only the
  // person who moved a photo there can Restore / Delete it — these cannot be
  // selected, and their full-screen view has no buttons.
  const isMine = (p: RecycleBinPhoto) => p.deletedBy !== 'organiser' && p.deletedBy !== 'admin';
  // "Deleted by Organiser" (no "the") so it fits one line (the user, 2026-11-01).
  const deletedByLabel = (p: RecycleBinPhoto) => (p.deletedBy === 'organiser' ? 'Deleted by Organiser' : 'Deleted by an Admin');
  // ⭐ WHO UPLOADED / WHO HANDED IT OVER (2026-11-01, the user's yes): the
  // full-screen info is always TWO lines (top may be empty), so the bottom
  // area keeps one height and the photo never moves when swiping.
  const viewerLines = (p: RecycleBinPhoto): [string, string] => {
    const days = daysLeftLabel(p.goneAt);
    if (!isMine(p)) return ['', `${deletedByLabel(p)} · ${days}`];
    if (p.handedOver) {
      const who = p.handedOverFromName ? `${p.handedOverFromName} (Admin)` : 'an Admin';
      return [p.uploaderName ? `Uploaded by ${p.uploaderName}` : '', `Deleted by ${who} · ${days}`];
    }
    if (p.uploaderName) return ['', `Uploaded by ${p.uploaderName} · ${days}`];
    return ['', days];
  };
  const mineIds = photos.filter(isMine).map(p => p.id);
  const selectedIds = [...selected];
  const allSelected = mineIds.length > 0 && selected.size === mineIds.length;
  const current = viewerIndex !== null ? photos[viewerIndex] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Full-screen card, as it has always looked (root Stack since 2026-11-01). */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.title}>Recycle bin</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.close}>×</Text>
        </TouchableOpacity>
      </View>
      {/* The user's wording, shortened 2026-10-31 ("everyone knows what
          Recycle bin is"). The event delete removes every photo, bin included. */}
      <Text style={styles.desc}>
        Deleted permanently after 30 days, or at once if the Organiser deletes the event.
      </Text>
      {!canRestore && (
        <Text style={styles.note}>This event has expired. Only the Organiser can restore photos.</Text>
      )}

      {loading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
      ) : photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your Recycle bin is empty</Text>
        </View>
      ) : (
        <>
          {/* ⭐ SELECT FIRST, DECIDE AFTER (the user, 2026-10-30): one Select
              button; in select mode the bar offers BOTH Restore and Delete
              permanently once photos are ticked. At the TOP, under the text,
              styled like Guest Uploads' select bar. */}
          {/* Select is ALWAYS shown, even when every photo here is read-only
              (the user, 2026-11-01: "The button should always be there"). */}
          {!selectMode ? (
            <View style={styles.btnRow}>
              <Pressable style={styles.selBtn} onPress={() => setSelectMode(true)}>
                <Text style={[styles.selBtnText, { color: Colors.white }]}>Select</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.selectBar}>
              <Text style={styles.selectCount}>{selected.size}</Text>
              <View style={styles.selectBarBtns}>
                <Pressable style={styles.selBtn} onPress={() => setSelected(allSelected ? new Set() : new Set(mineIds))}>
                  <Text style={styles.selBtnText}>{allSelected ? 'Clear' : 'Select all'}</Text>
                </Pressable>
                <Pressable style={styles.selBtn} onPress={() => { setSelectMode(false); setSelected(new Set()); }}>
                  <Text style={styles.selBtnText}>Cancel</Text>
                </Pressable>
                {/* Delete before Restore (2026-11-10, the user); the chips stay outlined. */}
                <Pressable
                  style={[styles.selBtn, { borderColor: Colors.danger }, (selected.size === 0 || busy) && { opacity: 0.4 }]}
                  disabled={selected.size === 0 || busy}
                  onPress={() => deletePermanently(selectedIds)}
                >
                  {/* "Delete", not "Delete permanently" (the user, 2026-10-30):
                      the long label made the bar wrap to 2 lines. The question
                      that follows and the full-screen view still say
                      "Delete permanently". */}
                  <Text style={[styles.selBtnText, { color: Colors.danger }]}>Delete</Text>
                </Pressable>
                <Pressable
                  style={[styles.selBtn, { borderColor: Colors.accent }, (selected.size === 0 || busy || !canRestore) && { opacity: 0.4 }]}
                  disabled={selected.size === 0 || busy}
                  onPress={() => restore(selectedIds)}
                >
                  <Text style={[styles.selBtnText, { color: Colors.accent }]}>Restore</Text>
                </Pressable>
              </View>
            </View>
          )}
          <FlatList
            data={photos}
            keyExtractor={p => p.id}
            numColumns={COLS}
            contentContainerStyle={{ paddingBottom: 16 }}
            renderItem={({ item, index }) => {
              const isSel = selected.has(item.id);
              const mine = isMine(item);
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={{ width: cell, height: cell, padding: 1 }}
                  onPress={() => (selectMode ? (mine && toggle(item.id)) : setViewerIndex(index))}
                  onLongPress={() => { if (!selectMode && mine) { setSelectMode(true); toggle(item.id); } }}
                >
                  <Image source={{ uri: item.thumbUrl ?? item.displayUrl }} style={[styles.thumb, isSel && styles.thumbSelected]} />
                  {/* Bottom-left, stacked: "Deleted by …" just above "N days
                      left" (the user, 2026-11-01). */}
                  <View style={styles.bottomTags}>
                    {!mine && (
                      <View style={styles.tagPill}>
                        <Text style={styles.byText} numberOfLines={1}>{deletedByLabel(item)}</Text>
                      </View>
                    )}
                    {/* Someone else's upload that I deleted: who uploaded it
                        (2026-11-01). Cut with … if long. */}
                    {mine && !!item.uploaderName && (
                      <View style={styles.tagPill}>
                        <Text style={styles.byText} numberOfLines={1}>By {item.uploaderName}</Text>
                      </View>
                    )}
                    <View style={styles.tagPill}>
                      <Text style={styles.daysText}>{daysLeftLabel(item.goneAt)}</Text>
                    </View>
                  </View>
                  {selectMode && mine && (
                    <View style={[styles.check, isSel && styles.checkOn]}>
                      {isSel && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  )}
                  {/* 🔒 ALWAYS on a read-only photo, in the tick circle's
                      corner (the user, 2026-11-01). NOT greyed out: dimmed
                      means BLOCKED and nothing else (convention 2026-10-21). */}
                  {!mine && (
                    <View style={styles.lock}>
                      <Text style={styles.lockText}>🔒</Text>
                    </View>
                  )}
                  {/* Handed over to me (the Organiser) from an Admin's bin
                      (2026-11-01): top-left — top-right is the tick / lock. */}
                  {mine && item.handedOver && (
                    <View style={styles.fromAdmin}>
                      <Text style={styles.byText}>From Admin</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      )}

      {/* Full-screen photo — the ONE shared piece (components/PhotoLightbox.tsx,
          2026-11-08): the same top bar as the other screens, no top buttons;
          the bin's own two lines + Restore / Delete permanently below
          (decided 2026-11-01). Alerts drawn inside it so they are not hidden. */}
      <PhotoLightbox
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
        items={photos}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        getKey={p => p.id}
        getUri={p => p.displayUrl}
        busy={busy ? (busyKind ?? 'delete') : null}
        footer={current ? (
            <View style={[styles.viewerBar, { paddingBottom: 16 + insets.bottom }]}>
              {/* Always two lines (the top one may be blank) — one height for
                  every photo, so the photo does not move when swiping. */}
              <View style={{ gap: 2 }}>
                <Text style={styles.viewerDays} numberOfLines={1}>{viewerLines(current)[0] || ' '}</Text>
                <Text style={styles.viewerDays} numberOfLines={1}>{viewerLines(current)[1]}</Text>
              </View>
              {/* ⛔ The button row is ALWAYS laid out, so the bottom area is
                  one height for every photo and the photo never moves up or
                  down when swiping (the user, 2026-11-01). On a read-only
                  photo it is invisible and cannot be tapped. */}
              <View
                style={[styles.barRow, !isMine(current) && { opacity: 0 }]}
                pointerEvents={isMine(current) ? 'auto' : 'none'}
              >
                {/* Delete on the LEFT, Restore on the RIGHT (2026-11-10, the user). */}
                <TouchableOpacity
                  style={[styles.deleteBtn, busy && { opacity: 0.4 }]}
                  disabled={busy || !isMine(current)}
                  onPress={() => deletePermanently([current.id])}
                >
                  <Text style={styles.deleteText}>Delete permanently</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.restoreBtn, (busy || !canRestore) && { opacity: 0.4 }]}
                  disabled={busy || !isMine(current)}
                  onPress={() => restore([current.id])}
                >
                  <Text style={styles.restoreText}>Restore</Text>
                </TouchableOpacity>
              </View>
            </View>
          
        ) : <View />}
        overlays={viewerIndex !== null ? alertOverlay : null}
      />

      {viewerIndex === null && alertOverlay}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.white },
  close: { fontSize: 28, color: Colors.textMuted, paddingHorizontal: 4 },
  desc: { fontSize: 13, color: Colors.textMuted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, lineHeight: 19 },
  note: { fontSize: 13, color: Colors.accent, paddingHorizontal: 16, paddingBottom: 8, lineHeight: 19 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.white, marginBottom: 8 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  thumb: { width: '100%', height: '100%', backgroundColor: '#1A1A1A' },
  thumbSelected: { opacity: 0.6 },
  byText: { fontSize: 10, fontWeight: '600', color: Colors.white },
  bottomTags: { position: 'absolute', left: 5, right: 5, bottom: 5, alignItems: 'flex-start', gap: 3 },
  tagPill: { backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, maxWidth: '100%' },
  fromAdmin: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  daysText: { fontSize: 10, color: Colors.white, fontWeight: '600' },
  check: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.white, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  lock: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  lockText: { fontSize: 11 },
  checkMark: { fontSize: 13, fontWeight: '800', color: Colors.background },
  // Same sizes as Guest Uploads' select bar (app/guest-uploads.tsx styles).
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.background, gap: 8 },
  selectCount: { fontSize: 22, fontWeight: '500', color: Colors.white, lineHeight: 24 },
  selectBarBtns: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  selBtn: { borderWidth: 0.5, borderColor: '#333', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selBtnText: { fontSize: 13, color: Colors.textMuted },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  restoreBtn: { flex: 1, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  restoreText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  // Solid red, bold white text (2026-11-10, the user's "Yes") — like Continue.
  deleteBtn: { flex: 1, backgroundColor: Colors.danger, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  deleteText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  viewerCounter: { fontSize: 15, color: Colors.white, fontWeight: '600' },
  viewerBar: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  viewerDays: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
});
