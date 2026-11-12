import React, { useState, useEffect, useRef, useMemo, useCallback, memo, forwardRef } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, StyleSheet,
  ActivityIndicator, Dimensions, Platform, Modal, Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
// ⏸ DEAD 2026-11-08 — review after 2027-01-08; delete ONLY after the user confirms
// (project_prelaunch_tidyup.md). Unused since the iPhone save chain moved to lib/photoSave.ts.
// let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
// try { PhotoSaver = require('photo-saver').default; } catch {}
import { findMyPhotos, findMyPhotosOpen, prepareZip, describeSkippedPhotos, isPhotoGoneError, DownloadCancelled, isDownloadCancelled } from '../lib/api';
import { usePhotoUrls, idsAroundRows } from '../lib/usePhotoUrls';
import PhotoLightbox from '../components/PhotoLightbox';
import PhotoActionRow from '../components/PhotoActionRow';
import { savePhotoToPhone, sharePhoto, androidFolderName } from '../lib/photoSave';
import { useAppPermission } from '../lib/permissions';
import { API_BASE_URL } from '../constants/config';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert } from '../lib/useAlert';
import { reportPerf, perfView, perfZipArrived } from '../lib/perf'; // ⏱ TEMPORARY — remove before the launch

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OVAL_W = SCREEN_WIDTH * 0.65;
const OVAL_H = SCREEN_WIDTH * 0.85;
const COLS = 3;
const GAP = 2;
const THUMB_SIZE = Math.floor((SCREEN_WIDTH - GAP * (COLS + 1)) / COLS);
const JPG_LIMIT = 40;

// download_name: the ONE download name from the server (2026-11-08); missing → that photo's download fails.
type Photo = { id: string; taken_at: string; uploaded_by_name?: string; download_name?: string | null };
// Plan C: a row counts as "on screen" as soon as any of it shows.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1, minimumViewTime: 100 };
// 'loading' = asking the server for this person's saved results; 'consent' =
// the Agree screen before the first selfie in an event (2026-11-10).
type Mode = 'loading' | 'consent' | 'camera' | 'searching' | 'results';

type ListItem =
  | { type: 'section_header'; label: string; count: number; sub: string; key: string }
  | { type: 'date_header'; date: string; ids: string[]; key: string }
  | { type: 'photo_row'; ids: string[]; startIndex: number; key: string };

function formatDateLabel(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Thumbnail component with ref support ──────────────────────────────────────
type ThumbProps = {
  id: string;
  thumbUrl?: string;
  isSelected: boolean;
  downloadMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
};
const Thumb = memo(forwardRef<View, ThumbProps>(function Thumb(
  { id, thumbUrl, isSelected, downloadMode, onPress, onLongPress }, ref
) {
  return (
    <TouchableOpacity
      ref={ref as any}
      style={styles.thumb}
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      {thumbUrl
        ? <ExpoImage source={{ uri: thumbUrl }} style={{ width: THUMB_SIZE, height: THUMB_SIZE }} contentFit="cover" recyclingKey={id} onLoadStart={() => perfView.thumbStart(thumbUrl)} onLoad={() => perfView.thumbLoaded(thumbUrl)} /* ⏱ PERF */ />
        : <View style={styles.thumbPlaceholder}><ActivityIndicator color={Colors.accent} /></View>
      }
      {downloadMode && (
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}));
Thumb.displayName = 'Thumb';

export default function MyPhotosScreen() {
  const params = useLocalSearchParams<{
    slug: string; adminPhone: string; userMobile: string;
    eventName: string; totalPhotos: string; photographers?: string;
  }>();
  // ⭐ Photographer's photos event (2026-11-11, the user): results in the
  // photographer's order as the server sends them — one list, no date headings.
  const photographerOrder = params.photographers === '1';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();
  // Photo permission before a full-screen Download, as on the Event screen (2026-11-08).
  const { requestAppPermission, primingOverlay } = useAppPermission();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [mode, setMode] = useState<Mode>('loading');
  // True once results have been shown, so the camera's ← goes back to them
  // (Search again) instead of leaving the screen.
  const hasResultsRef = useRef(false);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [otherPhotos, setOtherPhotos] = useState<Photo[]>([]);
  // Face search progress: the search runs in chunks; "found" drives the
  // "N found" line under "Searching…" (B4, face codes step 7).
  const [searchProgress, setSearchProgress] = useState<{ checked: number; total: number; found: number } | null>(null);
  // B9 (2026-11-04, the user's yes): the search covers scanned photos only;
  // `preparing` = photos not searched yet (still being scanned), shown on the
  // results screen so the guest knows to search again in a few minutes.
  const [preparing, setPreparing] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [downloadMode, setDownloadMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  // Download dialog, identical to the Event screen's: the pill spinner alone
  // gave no idea how far along a download was (user, 2026-10-08).
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  // Named downloadKind: this screen already has a boolean `downloadMode`
  // for the selection mode, which is a different thing entirely.
  const [downloadKind, setDownloadKind] = useState<'jpg' | 'zip'>('jpg');
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  // ZIP only: null while the server builds it (spinner), bytes once it downloads (bar).
  const [zipBytes, setZipBytes] = useState<{ received: number; total: number } | null>(null);
  const downloadCancelledRef = useRef(false);
  // ⛔ CANCELLING A ZIP NEEDS BOTH OF THESE, not just the flag above.
  // The flag is only read BETWEEN parts, so on its own it did nothing during
  // a part and nothing at all on the last one (reported 2026-10-18).
  // `zipAbortRef` stops the server call; `zipTaskRef` stops the transfer.
  // Mirrors event.tsx, the master — change all three together.
  const zipAbortRef = useRef<AbortController | null>(null);
  const zipTaskRef = useRef<{ cancelAsync: () => Promise<void> } | null>(null);
  // Lightbox single-photo download/share. actionLoading only DISABLED the
  // buttons, which do not grey out — so a tap looked ignored (user,
  // 2026-10-08). This drives the same overlay the Event screen shows.
  const [lightboxBusy, setLightboxBusy] = useState<null | 'download' | 'share'>(null);

  // Same approach as the Event screen: one effect keyed on the busy flags, so
  // every long job is covered and the lock is always released. The two
  // download paths here never had keep-awake at all, which is why the screen
  // dimmed mid-download (user, 2026-10-08). 'searching' is the face search.
  useEffect(() => {
    if (downloadingBulk || mode === 'searching') {
      activateKeepAwakeAsync();
      return () => { deactivateKeepAwake(); };
    }
  }, [downloadingBulk, mode]);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  // Mirrors lightboxVisible for code that reads it AFTER an await — the state a
  // function captured when it started is always "open". See
  // handleLightboxShare, and the fuller note in event.tsx.
  const lightboxVisibleRef = useRef(false);
  useEffect(() => { lightboxVisibleRef.current = lightboxVisible; }, [lightboxVisible]);

  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Drag select refs
  const photoRefsMap = useRef<Map<string, View>>(new Map());
  const longPressAnchorRef = useRef<{ anchorFlatIndex: number; anchorContentY: number } | null>(null);
  const committedSelectionRef = useRef<Set<string>>(new Set());
  const dragAnchorIndexRef = useRef<number | null>(null);
  const dragModeRef = useRef<'select' | 'deselect' | null>(null);
  const flatListLayoutRef = useRef({ x: 0, y: 0 });
  const flatListContainerRef = useRef<any>(null);
  const scrollOffsetRef = useRef(0);
  const accumulatedHeights = useRef<Record<string, number>>({});

  // ⭐ The lightbox's swipe / zoom / swipe-down gestures moved to the ONE shared
  // viewer, components/PhotoViewer.tsx (2026-11-05, the user's "Yes" — memory
  // project_download_progress_ui, UNIVERSAL VIEWER). Same rules (protected
  // item 5): direction locked once (dragAxis), 50 px sideways, zoom gating,
  // swipe-down 100 px / flick, blocked while busy, reset on every photo change.
  const listDataRef = useRef<ListItem[]>([]);
  // Needed to bring the grid to the photo the lightbox closed on.
  const listRef = useRef<FlashListRef<ListItem>>(null);

  const slug = params.slug;
  const eventName = params.eventName || slug;
  const adminPhone = params.adminPhone || undefined;
  const userMobile = params.userMobile || undefined;
  // Logged-in number for downloads/links; the server decides the role
  const idPhone = userMobile ?? adminPhone;
  // ⛔ Image addresses load AS NEEDED (2026-10-29, plan C) — see lib/usePhotoUrls.ts.
  // Called here, below slug and idPhone, which it needs; above every early return.
  const { urls: photoUrls, request: requestUrls } = usePhotoUrls(slug, () => idPhone);
  const totalPhotos = parseInt(params.totalPhotos ?? '0', 10);

  const allIds = useMemo(() => [
    ...photos.map(p => p.id),
    ...otherPhotos.map(p => p.id),
  ], [photos, otherPhotos]);

  const totalFound = allIds.length;

  const listItems = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    // Photographer's photos event: one list straight through, the server's order.
    if (photographerOrder) {
      const all = [...photos, ...otherPhotos].map(p => p.id);
      if (all.length > 0) {
        items.push({ type: 'section_header', label: 'Photo Gallery', count: all.length,
          sub: '(in file-name order)', key: 'header_main' });
        for (let i = 0; i < all.length; i += COLS) {
          items.push({ type: 'photo_row', ids: all.slice(i, i + COLS), startIndex: i, key: `row_pp_${i}` });
        }
      }
      listDataRef.current = items;
      return items;
    }

    if (photos.length > 0) {
      items.push({ type: 'section_header', label: 'Photo Gallery', count: photos.length,
        sub: '(grouped by date · oldest first)', key: 'header_main' });
      const groups: { date: string; ids: string[] }[] = [];
      for (const p of photos) {
        const d = formatDateLabel(p.taken_at);
        const last = groups[groups.length - 1];
        if (last && last.date === d) last.ids.push(p.id);
        else groups.push({ date: d, ids: [p.id] });
      }
      let globalIdx = 0;
      for (const g of groups) {
        items.push({ type: 'date_header', date: g.date, ids: g.ids, key: `date_main_${g.date}` });
        for (let i = 0; i < g.ids.length; i += COLS) {
          items.push({ type: 'photo_row', ids: g.ids.slice(i, i + COLS), startIndex: globalIdx + i, key: `row_main_${g.date}_${i}` });
        }
        globalIdx += g.ids.length;
      }
    }

    if (otherPhotos.length > 0) {
      // ⚠ A DIFFERENT SUBTITLE ON PURPOSE. These photos are in this section
      // precisely because their date is not trustworthy, so claiming they are
      // "grouped by date" would be untrue. Same wording the Event screen uses.
      items.push({ type: 'section_header', label: 'Other Photos Gallery', count: otherPhotos.length,
        sub: '(no date info — sorted by upload time)', key: 'header_other' });
      const groups: { date: string; ids: string[] }[] = [];
      const mainCount = photos.length;
      for (const p of otherPhotos) {
        const d = formatDateLabel(p.taken_at);
        const last = groups[groups.length - 1];
        if (last && last.date === d) last.ids.push(p.id);
        else groups.push({ date: d, ids: [p.id] });
      }
      let globalIdx = mainCount;
      for (const g of groups) {
        items.push({ type: 'date_header', date: g.date, ids: g.ids, key: `date_other_${g.date}` });
        for (let i = 0; i < g.ids.length; i += COLS) {
          items.push({ type: 'photo_row', ids: g.ids.slice(i, i + COLS), startIndex: globalIdx + i, key: `row_other_${g.date}_${i}` });
        }
        globalIdx += g.ids.length;
      }
    }

    listDataRef.current = items;
    return items;
  }, [photos, otherPhotos, photographerOrder]);

  // ── Image addresses for what is about to be shown (plan C) ──────────────
  const visibleRowsRef = useRef<{ first: number; last: number }>({ first: 0, last: 8 });
  const requestAroundVisible = useCallback(() => {
    const { first, last } = visibleRowsRef.current;
    requestUrls(idsAroundRows(listDataRef.current, first, last,
      row => (row.type === 'photo_row' ? row.ids : [])));
  }, [requestUrls]);
  const requestAroundVisibleRef = useRef(requestAroundVisible);
  useEffect(() => { requestAroundVisibleRef.current = requestAroundVisible; }, [requestAroundVisible]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const idx = viewableItems.map(v => v.index).filter((i): i is number => i !== null && i !== undefined);
    if (idx.length === 0) return;
    visibleRowsRef.current = { first: Math.min(...idx), last: Math.max(...idx) };
    requestAroundVisibleRef.current();
  }).current;
  useEffect(() => { requestAroundVisible(); }, [listItems, requestAroundVisible]);
  // The lightbox: the photo shown and two either side.
  useEffect(() => {
    if (!lightboxVisible) return;
    requestUrls([0, 1, -1, 2, -2]
      .map(d => allIds[lightboxIndex + d])
      .filter(Boolean) as string[]);
  }, [lightboxVisible, lightboxIndex, allIds, requestUrls]);

  // ── Drag select helpers ─────────────────────────────────────────────────────
  function getPhotoIdAtFlatIndex(index: number): string | null {
    let flatIndex = 0;
    for (const item of listDataRef.current) {
      if (item.type === 'photo_row') {
        if (index < flatIndex + item.ids.length) return item.ids[index - flatIndex];
        flatIndex += item.ids.length;
      }
    }
    return null;
  }

  function getPhotoIndexAtPosition(absX: number, absY: number): number | null {
    if (!longPressAnchorRef.current) return null;
    const fingerContentY = absY - flatListLayoutRef.current.y + scrollOffsetRef.current;
    const contentX = absX - flatListLayoutRef.current.x;
    const col = Math.min(Math.max(Math.floor(contentX / (THUMB_SIZE + GAP)), 0), COLS - 1);
    let cumY = 0;
    let photoFlatIndex = 0;
    for (const item of listDataRef.current) {
      const h = accumulatedHeights.current[item.key] ?? (item.type === 'photo_row' ? THUMB_SIZE + GAP : 0);
      if (item.type === 'photo_row') {
        if (fingerContentY >= cumY && fingerContentY < cumY + h) {
          return Math.min(photoFlatIndex + col, photoFlatIndex + item.ids.length - 1);
        }
        photoFlatIndex += item.ids.length;
      }
      cumY += h;
    }
    return null;
  }

  function applyDragRange(anchorIndex: number, currentIndex: number, mode: 'select' | 'deselect') {
    const lo = Math.min(anchorIndex, currentIndex);
    const hi = Math.max(anchorIndex, currentIndex);
    const next = new Set(committedSelectionRef.current);
    for (let i = lo; i <= hi; i++) {
      const id = getPhotoIdAtFlatIndex(i);
      if (id) { if (mode === 'select') next.add(id); else next.delete(id); }
    }
    setSelected(next);
  }

  function setAnchorForPhoto(photoId: string) {
    let flatIndex = 0;
    let found = false;
    for (const item of listDataRef.current) {
      if (item.type === 'photo_row') {
        const idx = item.ids.indexOf(photoId);
        if (idx >= 0) { flatIndex += idx; found = true; break; }
        flatIndex += item.ids.length;
      }
    }
    if (!found) return;
    const ref = photoRefsMap.current.get(photoId);
    if (!ref) return;
    (ref as any).measureInWindow((_x: number, y: number) => {
      const contentY = y - flatListLayoutRef.current.y + scrollOffsetRef.current;
      longPressAnchorRef.current = { anchorFlatIndex: flatIndex, anchorContentY: contentY };
    });
  }

  function handleThumbPress(id: string, globalIndex: number) {
    if (downloadMode) {
      if (!longPressAnchorRef.current) setAnchorForPhoto(id);
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        committedSelectionRef.current = next;
        return next;
      });
    } else {
      setLightboxIndex(globalIndex);
      setLightboxVisible(true);
    }
  }

  function handleThumbLongPress(id: string) {
    if (!downloadMode) {
      setDownloadMode(true);
      setAnchorForPhoto(id);
      setSelected(new Set([id]));
      committedSelectionRef.current = new Set([id]);
    }
  }

  const onDragStart = useCallback((absX: number, absY: number) => {
    if (!longPressAnchorRef.current) return;
    committedSelectionRef.current = new Set(selected);
    const index = getPhotoIndexAtPosition(absX, absY);
    if (index === null) return;
    const anchorId = getPhotoIdAtFlatIndex(index);
    const mode = anchorId && committedSelectionRef.current.has(anchorId) ? 'deselect' : 'select';
    dragAnchorIndexRef.current = index;
    dragModeRef.current = mode;
    applyDragRange(index, index, mode);
  }, [selected]);

  const onDragUpdate = useCallback((absX: number, absY: number) => {
    if (!longPressAnchorRef.current) return;
    const currentIndex = getPhotoIndexAtPosition(absX, absY);
    if (currentIndex === null) return;
    if (dragAnchorIndexRef.current === null) {
      const anchorId = getPhotoIdAtFlatIndex(currentIndex);
      dragAnchorIndexRef.current = currentIndex;
      dragModeRef.current = committedSelectionRef.current.has(anchorId ?? '') ? 'deselect' : 'select';
    }
    applyDragRange(dragAnchorIndexRef.current, currentIndex, dragModeRef.current!);
  }, []);

  const onDragEnd = useCallback(() => {
    dragAnchorIndexRef.current = null;
    dragModeRef.current = null;
  }, []);


  function navigateLightbox(dir: number) {
    setLightboxIndex(prev => {
      const next = prev + dir;
      if (next < 0 || next >= totalFound) return prev;
      return next;
    });
  }

  const dragGesture = useMemo(() => Gesture.Pan()
    .enabled(downloadMode)
    .activeOffsetX([-8, 8])
    .onStart((e) => { 'worklet'; runOnJS(onDragStart)(e.absoluteX, e.absoluteY); })
    .onUpdate((e) => { 'worklet'; runOnJS(onDragUpdate)(e.absoluteX, e.absoluteY); })
    .onFinalize(() => { 'worklet'; runOnJS(onDragEnd)(); })
  , [downloadMode, onDragStart, onDragUpdate, onDragEnd]);

  async function handleLightboxDownload() {
    const id = allIds[lightboxIndex];
    if (!id) return;
    showAlert('Download photo', 'Save this photo to your Downloads folder?', [
      {
        text: 'Download', onPress: async () => {
          setActionLoading(true);
          setLightboxBusy('download');
          try {
            const photo = [...photos, ...otherPhotos].find(p => p.id === id);
            // ⭐ The one save step (lib/photoSave.ts, 2026-11-08); name from the server.
            const tPerf = Date.now(); // ⏱ PERF
            await savePhotoToPhone({
              photoId: id, fileName: photo?.download_name, eventSlug: slug, eventName, idPhone,
              dateTakenMs: photo?.taken_at ? new Date(photo.taken_at).getTime() : undefined,
            });
            reportPerf('fmp', { kind: 'download', op: 'full-jpg', ms: Date.now() - tPerf }); // ⏱ PERF
            const folderName = Platform.OS === 'android' ? await androidFolderName(slug, eventName) : '';
            showAlert('Downloaded', Platform.OS === 'ios' ? 'Photo saved to your Photos.' : `Photo saved to Downloads/${folderName}.`);
          } catch (e) {
            showAlert('Download failed', isPhotoGoneError(e) ? 'This photo is no longer in the event.' : "This photo couldn't be downloaded. Please try again.");
          } finally {
            setLightboxBusy(null);
            setActionLoading(false);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleLightboxShare() {
    const id = allIds[lightboxIndex];
    if (!id) return;
    setActionLoading(true);
    setLightboxBusy('share');
    try {
      const photo = [...photos, ...otherPhotos].find(p => p.id === id);
      // ⭐ The one share step (lib/photoSave.ts): the date-stamped file.
      const tPerf = Date.now(); // ⏱ PERF
      await sharePhoto({ photoId: id, fileName: photo?.download_name, idPhone, stillOpen: () => lightboxVisibleRef.current });
      reportPerf('fmp', { kind: 'download', op: 'full-share', ms: Date.now() - tPerf }); // ⏱ PERF
    } catch (e) {
      showAlert('Share failed', isPhotoGoneError(e) ? 'This photo is no longer in the event.' : "This photo couldn't be shared. Please try again.");
    } finally {
      setLightboxBusy(null);
      setActionLoading(false);
    }
  }

  function exitDownloadMode() {
    setDownloadMode(false);
    setSelected(new Set());
    committedSelectionRef.current = new Set();
    longPressAnchorRef.current = null;
    dragAnchorIndexRef.current = null;
    dragModeRef.current = null;
  }

  function selectAll() {
    const next = new Set(allIds);
    setSelected(next);
    committedSelectionRef.current = next;
  }

  function deselectAll() {
    setSelected(new Set());
    committedSelectionRef.current = new Set();
  }

  function selectGroup(ids: string[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => { if (on) next.add(id); else next.delete(id); });
      committedSelectionRef.current = next;
      return next;
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  // ⭐ FIND MY PHOTOS REMEMBERS YOU, PER EVENT (2026-11-10, the user's
  // decisions; RULES G56): opening the screen first asks the server. With a
  // kept face in this event → straight to the saved results (no camera). The
  // first time in an event → the Agree screen, then the camera.
  // (The one-time 'Your selfie is never saved' pop-up was removed 2026-11-04.)
  useEffect(() => {
    async function init() {
      const res = await findMyPhotosOpen(slug);
      if (res.needsSelfie) {
        // The Agree screen is the app's standard pop-up card (the user,
        // 2026-11-10: "I do not like the Agree and cancel buttons. Fix it").
        setMode('consent');
        showAlert(
          'Find My Photos',
          'Your selfie will be used to find your photos in this event only. It is deleted when the event is deleted.',
          [
            { text: 'Agree', onPress: () => { openCamera(); } },
            { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
          ],
        );
        return;
      }
      if (res.error) {
        showAlert('Find My Photos', res.error, [{ text: 'OK', onPress: () => router.back() }]);
        return;
      }
      const main = (res.photos ?? []) as Photo[];
      const other = (res.otherPhotos ?? []) as Photo[];
      setPhotos(main);
      setOtherPhotos(other);
      setPreparing(typeof res.preparing === 'number' ? res.preparing : 0);
      hasResultsRef.current = true;
      setMode('results');
      const ids = [...main.map(p => p.id), ...other.map(p => p.id)];
      if (ids.length > 0) requestUrls(ids.slice(0, 60));
    }
    init();
  }, []);

  // Agree (first time) and Search again: open the camera, asking for camera
  // access first if needed.
  async function openCamera() {
    if (!permission?.granted) await requestPermission();
    setCameraReady(false);
    setMode('camera');
  }

  async function handleTakeSelfie() {
    if (capturing) return;
    setCapturing(true);
    try {
      // shutterSound is a real CameraPictureOptions flag in expo-camera 17
      // (default true). The selfie is a silent step in a flow, not a photo
      // the user is "taking", so the loud system click is wrong here.
      // iOS may still force it in regions where the law requires it.
      const photo = await cameraRef.current!.takePictureAsync({ quality: 0.9, shutterSound: false });
      const uri = photo!.uri;
      // Normalize EXIF rotation first — Image.getSize returns raw file dims on Android
      // which can be landscape even for a portrait selfie, making crop coords wrong.
      const norm = await ImageManipulator.manipulateAsync(uri, [], {
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const imgW = norm.width;
      const imgH = norm.height;
      const scaleX = imgW / SCREEN_WIDTH;
      const scaleY = imgH / SCREEN_HEIGHT;
      const originX = Math.max(0, Math.round(((SCREEN_WIDTH - OVAL_W) / 2) * scaleX));
      const originY = Math.max(0, Math.round(((SCREEN_HEIGHT - OVAL_H) / 2) * scaleY));
      const cropW = Math.min(Math.round(OVAL_W * scaleX), imgW - originX);
      const cropH = Math.min(Math.round(OVAL_H * scaleY), imgH - originY);
      const cropped = await ImageManipulator.manipulateAsync(
        norm.uri,
        [{ crop: { originX, originY, width: cropW, height: cropH } }],
        { base64: true, format: ImageManipulator.SaveFormat.JPEG }
      );
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      try { await FileSystem.deleteAsync(norm.uri, { idempotent: true }); } catch {}
      try { if (cropped.uri !== norm.uri) await FileSystem.deleteAsync(cropped.uri, { idempotent: true }); } catch {}
      const base64 = cropped.base64;
      if (!base64) { setCapturing(false); return; }
      setMode('searching');
      // ⭐ THE SEARCH RUNS IN CHUNKS (2026-11-01, the user's yes): the server
      // checks ~150 photos per request; we ask for the next chunk until the
      // whole event is covered (no 1,000-photo cap), showing progress.
      // Photos that could not be checked are counted and reported — never
      // silently treated as "not you". The selfie picture is never stored; since
      // 2026-11-10 the server keeps its FACE CODE for this event only (the
      // person agreed first — RULES G56).
      let total = totalPhotos;
      let checked = 0;
      let failedCount = 0;
      let stoppedEarly = false;
      let after: string | null = null;
      const main: Photo[] = [];
      const other: Photo[] = [];
      // A photo can come back in two answers (rare: upgraded while the search
      // ran) — keep each photo once.
      const seen = new Set<string>();
      const fresh = (list: Photo[]) => list.filter(p => !seen.has(p.id) && (seen.add(p.id), true));
      setPreparing(0);
      setSearchProgress({ checked: 0, total, found: 0 });
      const tPerfSearch = Date.now(); // ⏱ PERF
      do {
        const result = await findMyPhotos(slug, base64, adminPhone, userMobile, after);
        if (result.error) {
          if (checked === 0) {
            // First chunk failed (e.g. no face in the selfie): back to the camera.
            setCameraReady(false);
            // B9.5: "getting ready" is not an error — titled as the feature.
            // ⚠ LOAD-BEARING (RULES G28): matches the server's GETTING_READY text.
            // Case-insensitive so the 2026-11-10 rename ("Find My Photos") works
            // with the old and the new server wording.
            const title = result.error.toLowerCase().startsWith('find my photos is getting ready') ? 'Find My Photos' : 'Error';
            showAlert(title, result.error, [{ text: 'Try Again', onPress: () => setMode('camera') }]);
            setMode('camera');
            setCapturing(false);
            setSearchProgress(null);
            return;
          }
          // A later chunk failed: keep what was found, say the search stopped.
          stoppedEarly = true;
          break;
        }
        if (typeof result.total === 'number') total = result.total;
        if (typeof result.preparing === 'number') setPreparing(result.preparing);
        main.push(...fresh((result.photos ?? []) as Photo[]));
        other.push(...fresh((result.otherPhotos ?? []) as Photo[]));
        checked += result.checked ?? 0;
        failedCount += result.failed ?? 0;
        setSearchProgress({ checked, total, found: main.length + other.length });
        after = result.next ?? null;
      } while (after);
      // Each chunk comes back sorted; sort the whole list oldest first.
      const byTime = (a: Photo, b: Photo) => new Date(a.taken_at || 0).getTime() - new Date(b.taken_at || 0).getTime();
      // A Photographer's photos event keeps the server's order (file names).
      if (!photographerOrder) {
        main.sort(byTime);
        other.sort(byTime);
      }
      setSearchProgress(null);
      if (stoppedEarly) {
        showAlert('Search stopped part-way', `Checked ${checked} of ${total} photos. Try again to search the rest.`);
      } else if (failedCount > 0) {
        showAlert(
          'Some photos could not be checked',
          `${failedCount} photo${failedCount === 1 ? '' : 's'} could not be checked. Try again to search ${failedCount === 1 ? 'it' : 'them'}.`,
        );
      }
      setPhotos(main);
      setOtherPhotos(other);
      hasResultsRef.current = true;
      setMode('results');
      reportPerf('fmp', { kind: 'search', op: 'app', matches: main.length + other.length, ms: Date.now() - tPerfSearch }); // ⏱ PERF
      perfView.open('fmp'); // ⏱ PERF
      const ids = [...main.map(p => p.id), ...other.map(p => p.id)];
      // The first screens straight away; the grid asks for the rest as it scrolls.
      if (ids.length > 0) requestUrls(ids.slice(0, 60));
      // ⛔ DO NOT CLEAR THE BREADCRUMB HERE. It was cleared on this line until
      // 2026-10-17, three lines after step 8 was written — so the delete and
      // the crash RACED. One run the crash won and we saw "8"; the next the
      // delete won and the evidence vanished, which read as the bug changing.
      // The run is NOT complete here: the screen has not drawn yet. Step 9
      // below is written once it has, and that is the only honest "finished".
    } catch (e: any) {
      // A JS error is caught here and shown. If the app DIES instead, this
      // never runs and the breadcrumb above is the only evidence.
      setCameraReady(false);
      showAlert('Error', e?.message ?? 'Something went wrong. Please try again.', [{ text: 'OK', onPress: () => setMode('camera') }]);
      setMode('camera');
    }
    setCapturing(false);
  }

  async function handleDownload() {
    const ids = [...selected];
    if (ids.length === 0) return;
    // ⭐ Always a choice (2026-11-07) — same as the Event screen. Above
    // JPG_LIMIT, JPG asks once more; more than one ZIP → Save as ZIP asks
    // once more, naming how many.
    const zipCount = Math.ceil(ids.length / 50);
    showAlert('How would you like to download?', undefined, [
      {
        text: 'Save as JPG',
        onPress: () => {
          if (ids.length > JPG_LIMIT) {
            showAlert(
              `Save ${ids.length} photos one by one?`,
              `Saving more than ${JPG_LIMIT} photos as JPG can take a while. Keep this screen open until it finishes. A ZIP may be quicker for large downloads.`,
              [
                { text: 'Save as JPG', onPress: () => doDownloadJpgs(ids) },
                { text: 'Cancel', style: 'cancel' },
              ],
              undefined, false, true
            );
            return;
          }
          doDownloadJpgs(ids);
        },
      },
      {
        text: 'Save as ZIP',
        onPress: () => {
          // Always asked, also for one ZIP (2026-11-12, the user's "Yes").
          showAlert(
            zipCount > 1 ? `Save as ${zipCount} ZIP files?` : 'Save as a ZIP file?',
            zipCount > 1
              ? `A ZIP holds up to 50 photos, so your ${ids.length} photos will be saved as ${zipCount} ZIP files.`
              : `A ZIP holds up to 50 photos, so your ${ids.length} photo${ids.length === 1 ? '' : 's'} will be saved as one ZIP file.`,
            [
              { text: 'Save as ZIP', onPress: () => doDownloadZip(ids) },
              { text: 'Cancel', style: 'cancel' },
            ],
            undefined, false, true
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Same helper as the Event screen: createDownloadResumable reports bytes as
  // they arrive, which is what lets the dialog show a real bar.
  async function downloadZipWithProgress(url: string, cacheUri: string): Promise<void> {
    setZipBytes({ received: 0, total: 0 });
    const task = FileSystem.createDownloadResumable(url, cacheUri, {}, (pr) => {
      setZipBytes({
        received: pr.totalBytesWritten,
        total: pr.totalBytesExpectedToWrite > 0 ? pr.totalBytesExpectedToWrite : 0,
      });
    });
    // ⛔ Hand the task to Cancel — see event.tsx for why the flag alone
    // was not enough. `cancelAsync` stops the transfer mid-flight.
    const tPerfDl = Date.now(); // ⏱ PERF
    zipTaskRef.current = task;
    let dlResult;
    try {
      dlResult = await task.downloadAsync();
    } finally {
      zipTaskRef.current = null;
    }
    // A cancelled task resolves undefined rather than throwing.
    if (downloadCancelledRef.current) throw new DownloadCancelled();
    if (!dlResult || dlResult.status !== 200) throw new Error(`HTTP ${dlResult?.status ?? 'error'}`);
    perfZipArrived('fmp', cacheUri, Date.now() - tPerfDl); // ⏱ PERF
  }

  // ⏱ TEMPORARY (2026-11-10, the user's "Yes"): one RUN_SUMMARY line per finished
  // multi-photo download. Remove before the launch (project_performance_tests.md).
  async function doDownloadJpgs(ids: string[]) {
    const tRun = Date.now(); // ⏱ PERF
    try { await doDownloadJpgsInner(ids); }
    finally { reportPerf('fmp', { kind: 'summary', op: 'select-jpg', n: ids.length, cancelled: downloadCancelledRef.current ? 1 : 0, ms: Date.now() - tRun }); } // ⏱ PERF
  }
  async function doDownloadJpgsInner(ids: string[]) {
    downloadCancelledRef.current = false;
    setDownloadKind('jpg');
    setDownloadProgress({ current: 0, total: ids.length });
    setDownloadingBulk(true);
    // Deliberately NOT setActionLoading: that spins the Download pill, which
    // now sits behind the progress dialog and just looks like a second,
    // contradictory indicator.
    // ⚠ Above the try so the catch can read it — as event.tsx does.
    let saved = 0;
    try {
      let folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`);
      if (!folderName) {
        folderName = eventName;
        await SecureStore.setItemAsync(`downloads_folder_name_${slug}`, folderName);
      }
      // ⛔ Kept apart: a photo deleted from the event answers 404 and can
      // never be fetched again, so it must not land in the retry list.
      const failedIds: string[] = [];
      const goneIds: string[] = [];
      let done = 0;
      for (const id of ids) {
        if (downloadCancelledRef.current) break;
        setDownloadProgress({ current: done, total: ids.length });
        try {
          const photo = [...photos, ...otherPhotos].find(p => p.id === id);
          // ⭐ The one save step (lib/photoSave.ts); no name → counted as failed.
          const tPerf = Date.now(); // ⏱ PERF
          await savePhotoToPhone({
            photoId: id, fileName: photo?.download_name, eventSlug: slug, eventName, idPhone,
            dateTakenMs: photo?.taken_at ? new Date(photo.taken_at).getTime() : undefined,
          });
          reportPerf('fmp', { kind: 'download', op: 'select-jpg', ms: Date.now() - tPerf }); // ⏱ PERF
          saved++;
        // ⛔ This used to be a bare `catch {}` — a photo could vanish from a
        // download and the alert still read "N photos saved". Nothing was
        // reported and nothing could be retried.
        } catch (e) { (isPhotoGoneError(e) ? goneIds : failedIds).push(id); }
        done++;
        setDownloadProgress({ current: done, total: ids.length });
      }
      setDownloadingBulk(false);
      exitDownloadMode();
      // ⛔ A CANCELLED run must not be reported as "Download complete".
      // The JPG loop does not throw on cancel — it breaks and falls through
      // to here — so the check belongs at the message, not in the catch.
      // Mirrors event.tsx, the master. [[feedback-event-screen-is-master]]
      if (downloadCancelledRef.current) {
        showAlert('Download cancelled',
          saved > 0
            ? `${saved} of ${ids.length} photo${ids.length === 1 ? '' : 's'} saved before you cancelled.`
            : 'Nothing was saved.');
        return;
      }
      const base = Platform.OS === 'ios'
        ? `${saved} photo${saved !== 1 ? 's' : ''} saved to your Photos.`
        : `${saved} photo${saved !== 1 ? 's' : ''} saved to Downloads.`;
      const { note, retryable: jpgRetry } = describeSkippedPhotos(goneIds, failedIds);
      if (jpgRetry.length > 0) {
        showAlert('Download complete', `${base} ${note}`, [
          { text: `Retry ${jpgRetry.length}`, onPress: async () => { await doDownloadJpgs(jpgRetry); } },
          { text: 'OK' },
        ]);
      } else {
        showAlert('Download complete', note ? `${base} ${note}` : base);
      }
    } catch (e: any) {
      // ⛔ A cancel is NOT a failure. Before this, pressing Cancel surfaced
      // "Download failed: Aborted" — telling the user something broke when
      // they had asked it to stop. Mirrors event.tsx, the master.
      if (isDownloadCancelled(e) || downloadCancelledRef.current) {
        showAlert('Download cancelled',
          saved > 0
            ? `${saved} of ${ids.length} photo${ids.length === 1 ? '' : 's'} saved before you cancelled.`
            : 'Nothing was saved.');
        return;
      }
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setDownloadingBulk(false);
    }
  }

  // ⏱ TEMPORARY (2026-11-10, the user's "Yes"): one RUN_SUMMARY line per finished
  // multi-photo download. Remove before the launch (project_performance_tests.md).
  async function doDownloadZip(ids: string[]) {
    const tRun = Date.now(); // ⏱ PERF
    try { await doDownloadZipInner(ids); }
    finally { reportPerf('fmp', { kind: 'summary', op: 'zip', n: ids.length, cancelled: downloadCancelledRef.current ? 1 : 0, ms: Date.now() - tRun }); } // ⏱ PERF
  }
  async function doDownloadZipInner(ids: string[]) {
    // Kept apart on purpose — only the unreadable ones can be retried.
    const allMissing: string[] = [];
    const allUnreadable: string[] = [];
    const batchCount = Math.ceil(ids.length / 50);
    downloadCancelledRef.current = false;
    setDownloadKind('zip');
    setDownloadProgress({ current: 0, total: batchCount });
    setZipBytes(null);
    setDownloadingBulk(true);
    const batches = chunk(ids, 50);
    // ⚠ Declared ABOVE the try so the catch can read them — the shape
    // event.tsx already uses. Counts parts that ACTUALLY saved.
    let savedBatches = 0;
    try {
      for (let i = 0; i < batches.length; i++) {
        if (downloadCancelledRef.current) break;
        setDownloadProgress({ current: i + 1, total: batches.length });
        setZipBytes(null); // this part is being built — spinner, not bar
        const filename = batches.length > 1
          ? `${slug}-photos-part${i + 1}of${batches.length}.zip`
          : `${slug}-photos.zip`;
        zipAbortRef.current = new AbortController();
        const tPerfZip = Date.now(); // ⏱ PERF
        const zipRes = await prepareZip(slug, batches[i], idPhone, zipAbortRef.current.signal);
        reportPerf('fmp', { kind: 'download', op: 'zip-wait', n: batches[i].length, ms: Date.now() - tPerfZip }); // ⏱ PERF
        // ⛔ Check AFTER the await — that is where the time goes.
        if (downloadCancelledRef.current) throw new DownloadCancelled();
        if (zipRes.error) throw new Error(zipRes.error);
        if (zipRes.missingIds?.length) allMissing.push(...zipRes.missingIds);
        if (zipRes.unreadableIds?.length) allUnreadable.push(...zipRes.unreadableIds);
        const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
        await downloadZipWithProgress(zipRes.zipUrl, cacheUri);
        if (Platform.OS === 'android') {
          let folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`);
          if (!folderName) {
            folderName = eventName;
            await SecureStore.setItemAsync(`downloads_folder_name_${slug}`, folderName);
          }
          const localPath = cacheUri.replace('file://', '');
          await MediaStore.saveToDownloads(localPath, filename, folderName, 'application/zip');
        } else {
          await Sharing.shareAsync(cacheUri, { mimeType: 'application/zip', dialogTitle: 'Save ZIP' });
        }
        await FileSystem.deleteAsync(cacheUri, { idempotent: true });
        savedBatches++;   // only after the save really happened
      }
      exitDownloadMode();
      const base = Platform.OS === 'ios'
        ? (batches.length > 1 ? `${savedBatches} of ${batches.length} ZIPs shared.` : 'ZIP shared.')
        : (batches.length > 1 ? `${savedBatches} of ${batches.length} ZIPs saved to Downloads.` : 'ZIP saved to Downloads.');
      // ⛔ Never report a short zip as a plain success, and never offer a
      // retry for a photo that no longer exists.
      const { note, retryable } = describeSkippedPhotos(allMissing, allUnreadable);
      if (retryable.length > 0) {
        showAlert('Download complete', `${base} ${note}`, [
          { text: `Retry ${retryable.length}`, onPress: async () => { await doDownloadZip(retryable); } },
          { text: 'OK' },
        ]);
      } else if (note) {
        showAlert('Download complete', `${base} ${note}`);
      } else {
        showAlert('Download complete', base);
      }
    } catch (e: any) {
      // ⛔ A cancel is NOT a failure. Before this, pressing Cancel surfaced
      // "Download failed: Aborted" — telling the user something broke when
      // they had asked it to stop. Mirrors event.tsx, the master.
      if (isDownloadCancelled(e) || downloadCancelledRef.current) {
        showAlert('Download cancelled',
          savedBatches > 0
            ? `${savedBatches} of ${batches.length} ZIP${batches.length === 1 ? '' : 's'} saved before you cancelled.`
            : 'Nothing was saved.');
        return;
      }
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      // MUST clear both. Clearing only actionLoading left the progress dialog
      // on screen for good once the ZIP finished.
      setDownloadingBulk(false);
      setZipBytes(null);
    }
  }

  // ⛔ THESE TWO HOOKS MUST STAY ABOVE THE EARLY RETURNS BELOW.
  // They sat BELOW `if (mode === 'camera')` and `if (mode === 'searching')`
  // from 2026-10-14 until 2026-10-17. Those modes return early, so the hooks
  // did not run; the moment the screen became 'results' it fell through and
  // React saw TWO MORE HOOKS THAN THE PREVIOUS RENDER — a hard error, thrown
  // before any JSX. The screen went blank on Android and killed the app on
  // iOS, and Find My Photos was unusable for three days.
  // ⚠ Any hook added to this file goes ABOVE line `if (mode === 'camera')`.
  // The other two screens were unaffected: they have no hooks after an early
  // return. Only this screen does.
  // Closing the lightbox used to leave the grid exactly where it was when the
  // lightbox opened: the Modal sits OVER this screen, so the list never
  // unmounts and keeps its old scroll position. Bring it to the photo the user
  // actually finished on. ONE effect covers EVERY way of closing -- the header
  // x, the swipe down, and Android's back button.
  //
  // NOTE this screen differs from the other two: its rows carry `ids` (plain
  // strings), not photo objects, and the lightbox indexes `allIds` rather than
  // a photos array. Copying the Event screen's version here would not compile.
  const lightboxWasVisible = useRef(false);
  useEffect(() => {
    if (lightboxWasVisible.current && !lightboxVisible && allIds.length > 0) {
      const targetId = allIds[Math.min(lightboxIndex, allIds.length - 1)];
      if (targetId) {
        const row = listDataRef.current.findIndex(
          it => it.type === 'photo_row' && it.ids.includes(targetId)
        );
        // viewPosition 0.5 centres it rather than parking it under the header.
        if (row >= 0) {
          listRef.current?.scrollToIndex({ index: row, animated: false, viewPosition: 0.5 })
            .catch(() => {});
        }
      }
    }
    lightboxWasVisible.current = lightboxVisible;
  }, [lightboxVisible, lightboxIndex, allIds]);

  // ── Camera screen ──────────────────────────────────────────────────────────
  if (mode === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted
          ? <>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="front"
                onCameraReady={() => setCameraReady(true)}
              />
              <View style={styles.ovalContainer} pointerEvents="none">
                <View style={[styles.oval, { borderColor: '#fff' }]} />
              </View>
            </>
          : <View style={styles.permDenied}>
              <Text style={styles.permDeniedText}>
                Camera access is needed to take a selfie.{'\n'}Please enable it in Settings.
              </Text>
            </View>
        }
        <View style={[styles.cameraHeader, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => { if (hasResultsRef.current) { setMode('results'); return; } router.back(); }}>
            <Text style={styles.camBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>Find My Photos</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={[styles.cameraFooter, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.cameraHint}>
            Position your face in the oval and tap to search
          </Text>
          <TouchableOpacity style={styles.captureBtn} onPress={handleTakeSelfie} disabled={capturing || !permission?.granted || !cameraReady}>
            {capturing ? <ActivityIndicator color="#000" /> : <View style={styles.captureBtnInner} />}
          </TouchableOpacity>
        </View>
        {alertOverlay}
      </View>
    );
  }

  // ── Searching screen ────────────────────────────────────────────────────────
  if (mode === 'searching') {
    return (
      <View style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={Colors.accent} />
        {/* B4 (face codes): "Searching…" replaces "checked X of Y" — most of
            the event is now searched in one step, so a count would jump. */}
        <Text style={styles.searchingText}>Searching…</Text>
        {searchProgress && searchProgress.found > 0 ? (
          <Text style={[styles.searchingText, { marginTop: 6 }]}>
            {searchProgress.found} found
          </Text>
        ) : null}
      </View>
    );
  }

  // ── Loading (asking the server for saved results) ───────────────────────────
  if (mode === 'loading') {
    return (
      <View style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={Colors.accent} />
        {alertOverlay}
      </View>
    );
  }

  // ── Agree screen — the first time in this event (2026-11-10) ────────────────
  // The Agree card itself is the standard pop-up, shown from init above; this
  // is only the dark screen behind it.
  if (mode === 'consent') {
    return (
      <View style={styles.centeredScreen}>
        {alertOverlay}
      </View>
    );
  }

  // ── Results screen ──────────────────────────────────────────────────────────
  const currentLbId = allIds[lightboxIndex];
  const currentLbUrls = photoUrls[currentLbId];
  const currentLbPhoto = lightboxIndex < photos.length ? photos[lightboxIndex] : otherPhotos[lightboxIndex - photos.length];
  const lightboxImageUrl = currentLbUrls?.displayUrl ?? currentLbUrls?.url ?? null;

  const allSelected = selected.size === totalFound;

  // The close button drawn ON the busy cover, so it stays tappable while the
  // cover is up. A child of the topmost view receives taps by definition —
  // see the longer note in event.tsx for why that matters.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (downloadMode) { exitDownloadMode(); return; } router.back(); }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Find My Photos</Text>
          {totalFound > 0 && <Text style={styles.headerSub}>{totalFound} photo{totalFound !== 1 ? 's' : ''} found</Text>}
          {photos.length > 0 && otherPhotos.length > 0 && (
            <Text style={styles.headerSubLine}>
              {photos.length} in Photo Gallery · {otherPhotos.length} in Other Photos Gallery
            </Text>
          )}
        </View>
        <View style={{ width: 32 }} />
      </View>

      {/* B9: photos not searched yet (still being scanned). */}
      {preparing > 0 && (
        <Text style={[styles.searchingText, { marginHorizontal: 16, marginTop: 8 }]}>
          {preparing} photo{preparing !== 1 ? 's are' : ' is'} still being prepared. {preparing !== 1 ? 'They' : 'It'} will be included the next time you open Find My Photos.
        </Text>
      )}

      {totalFound === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No photos of you were found in this event.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={openCamera}>
            <Text style={styles.retryBtnText}>Search again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Action row / select bar */}
          {!downloadMode ? (
            // ⭐ The shared photo-screen button row (components/PhotoActionRow.tsx,
            // 2026-11-10): Search again at the FAR LEFT where Delete Photos sits
            // on the Event screen, gold outline (the user's "Yes for both"); a
            // new selfie replaces the kept face. Download Photos far right.
            <PhotoActionRow
              leftKind="accent"
              left={{ label: 'Search again', onPress: openCamera }}
              right={{ label: 'Download Photos', onPress: () => setDownloadMode(true) }}
            />
          ) : (
            <View style={styles.selectBar}>
              <Text style={styles.selectCount}>{selected.size}</Text>
              <View style={styles.selectBarBtns}>
                <Pressable style={styles.selBtn} onPress={() => allSelected ? deselectAll() : selectAll()}>
                  <Text style={styles.selBtnText}>Select all</Text>
                </Pressable>
                <Pressable style={styles.selBtn} onPress={exitDownloadMode}>
                  <Text style={styles.selBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.selBtn, selected.size === 0 && { opacity: 0.4 }]}
                  disabled={selected.size === 0 || actionLoading}
                  onPress={handleDownload}
                >
                  {actionLoading
                    ? <ActivityIndicator size="small" color={Colors.accent} />
                    : <Text style={[styles.selBtnText, { color: Colors.accent }]}>Download</Text>
                  }
                </Pressable>
              </View>
            </View>
          )}

          {/* Photo grid */}
          <View
            style={{ flex: 1 }}
            ref={flatListContainerRef}
            onLayout={() => {
              flatListContainerRef.current?.measure((_x: number, _y: number, _w: number, _h: number, pageX: number, pageY: number) => {
                flatListLayoutRef.current = { x: pageX, y: pageY };
              });
            }}
          >
          <GestureDetector gesture={dragGesture}>
            <FlashList
              ref={listRef}
              data={listItems}
              keyExtractor={item => item.key}
              estimatedItemSize={THUMB_SIZE + GAP}
              extraData={photoUrls}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={VIEWABILITY_CONFIG}
              contentContainerStyle={{ paddingBottom: 20 }}
              onScroll={e => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
              renderItem={({ item }) => {
                if (item.type === 'section_header') {
                  return (
                    <View
                      style={styles.sectionHeader}
                      onLayout={e => { accumulatedHeights.current[item.key] = e.nativeEvent.layout.height; }}
                    >
                      <View style={styles.galleryTitleRow}>
                        <Text style={styles.galleryTitle}>{item.label}</Text>
                        <Text style={styles.galleryCount}>{item.count}</Text>
                      </View>
                      <Text style={styles.gallerySub}>{item.sub}</Text>
                    </View>
                  );
                }
                if (item.type === 'date_header') {
                  const allGroupSelected = item.ids.every(id => selected.has(id));
                  return (
                    <View
                      style={styles.dateHeaderRow}
                      onLayout={e => { accumulatedHeights.current[item.key] = e.nativeEvent.layout.height; }}
                    >
                      {downloadMode && (
                        <TouchableOpacity
                          style={styles.dateHeaderCircle}
                          onPress={() => selectGroup(item.ids, !allGroupSelected)}
                        >
                          <View style={[styles.groupCircle, allGroupSelected && styles.groupCircleSelected]}>
                            {allGroupSelected && <Text style={styles.groupCircleTick}>✓</Text>}
                          </View>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.dateHeaderText}>{item.date}</Text>
                    </View>
                  );
                }
                // photo_row
                return (
                  <View
                    style={styles.photoRow}
                    onLayout={e => { accumulatedHeights.current[item.key] = e.nativeEvent.layout.height; }}
                  >
                    {item.ids.map((id, idx) => {
                      const urls = photoUrls[id];
                      const globalIndex = item.startIndex + idx;
                      return (
                        <View key={id} style={[styles.thumbWrap, idx < COLS - 1 && { marginRight: GAP }]}>
                          <Thumb
                            ref={r => { if (r) photoRefsMap.current.set(id, r as View); else photoRefsMap.current.delete(id); }}
                            id={id}
                            thumbUrl={urls?.thumbUrl ?? null}
                            isSelected={selected.has(id)}
                            downloadMode={downloadMode}
                            onPress={() => handleThumbPress(id, globalIndex)}
                            onLongPress={() => handleThumbLongPress(id)}
                          />
                        </View>
                      );
                    })}
                    {item.ids.length < COLS && Array.from({ length: COLS - item.ids.length }).map((_, i) => (
                      <View key={`empty_${i}`} style={{ width: THUMB_SIZE, marginRight: i < COLS - item.ids.length - 1 ? GAP : 0 }} />
                    ))}
                  </View>
                );
              }}
            />
          </GestureDetector>
          </View>
        </>
      )}

      {/* Full-screen photo — the ONE shared piece (components/PhotoLightbox.tsx,
          2026-11-08). No Delete here — decided: Find My Photos never deletes. */}
      <PhotoLightbox
        visible={lightboxVisible}
        onClose={() => setLightboxVisible(false)}
        items={allIds}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onLoadingChange={l => perfView.fullLoading(l)} /* ⏱ PERF */
        getKey={id => id}
        getUri={id => photoUrls[id]?.displayUrl ?? photoUrls[id]?.url ?? null}
        busy={lightboxBusy ?? null}
        actions={{
          canDelete: false,
          onDelete: () => {},
          onDownload: () => requestAppPermission('gallery', handleLightboxDownload, idPhone ?? null),
          onShare: handleLightboxShare,
        }}
        caption={{ uploadedBy: currentLbPhoto?.uploaded_by_name, takenAt: currentLbPhoto?.taken_at }}
        overlays={<>{lightboxVisible && primingOverlay}{alertOverlay}</>}
      />

      {downloadingBulk && (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadOverlayCard}>
            <View style={styles.uploadOverlayHeader}>
              <Text style={styles.uploadOverlayTitle}>
                {/* ⛔ Title follows the PHASE, not the job — see event.tsx,
                    the master. All four copies change together. */}
                {downloadKind === 'zip'
                  ? (zipBytes ? 'Downloading ZIP' : 'Preparing ZIP')
                  : 'Downloading'}
              </Text>
              <TouchableOpacity onPress={() => {
                downloadCancelledRef.current = true;
                zipAbortRef.current?.abort();
                zipTaskRef.current?.cancelAsync().catch(() => {});
              }}>
                <Text style={styles.uploadOverlayCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {downloadKind === 'zip' ? (
              // Two phases: the server builds the ZIP (nothing to measure, so a
              // spinner), then it downloads (real bytes, so a bar).
              !zipBytes || zipBytes.total === 0 ? (
                <>
                  <Text style={styles.uploadOverlaySub}>
                    {downloadProgress.total > 1
                      ? `Preparing ZIP ${downloadProgress.current} of ${downloadProgress.total}…`
                      : 'Preparing ZIP… this may take a minute'}
                  </Text>
                  <ActivityIndicator color={Colors.accent} style={{ marginVertical: 8 }} />
                  <Text style={styles.uploadOverlayPct}>Keep this screen open</Text>
                </>
              ) : (
                <>
                  <Text style={styles.uploadOverlaySub}>
                    {downloadProgress.total > 1
                      ? `Downloading ZIP ${downloadProgress.current} of ${downloadProgress.total}…`
                      : 'Downloading ZIP…'}
                  </Text>
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, {
                      width: `${Math.round((zipBytes.received / zipBytes.total) * 100)}%` as any,
                    }]} />
                  </View>
                  <Text style={styles.uploadOverlayPct}>
                    {Math.round((zipBytes.received / zipBytes.total) * 100)}% complete — keep this screen open
                  </Text>
                </>
              )
            ) : (
              <>
                <Text style={styles.uploadOverlaySub}>
                  Downloading photo {Math.min(downloadProgress.current + 1, downloadProgress.total)} of {downloadProgress.total}…
                </Text>
                <View style={styles.progressBg}>
                  <View style={[styles.progressFill, {
                    width: `${downloadProgress.total > 0 ? Math.round((downloadProgress.current / downloadProgress.total) * 100) : 0}%` as any,
                  }]} />
                </View>
                <Text style={styles.uploadOverlayPct}>
                  {downloadProgress.total > 0 ? Math.round((downloadProgress.current / downloadProgress.total) * 100) : 0}% complete — keep this screen open
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Lightbox busy overlay — copied from app/event.tsx so both match.
  lbDownloadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10, justifyContent: 'center', alignItems: 'center', gap: 12 },
  lbDownloadText: { color: Colors.white, fontSize: 14, fontWeight: '500' },
  // Download dialog — copied from app/event.tsx so both screens look identical.
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  uploadOverlayCard: { width: '100%', backgroundColor: Colors.card, borderRadius: 16, padding: 20 },
  uploadOverlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  uploadOverlayTitle: { fontSize: 16, fontWeight: '600', color: Colors.white },
  uploadOverlayCancel: { fontSize: 13, color: Colors.danger },
  uploadOverlaySub: { fontSize: 13, color: Colors.textMuted, marginBottom: 10 },
  progressBg: { height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: Colors.white, borderRadius: 4 },
  uploadOverlayPct: { fontSize: 11, color: '#666' },
  // Camera
  cameraHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  camBackText: { fontSize: 24, color: '#fff' },
  cameraTitle: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  cameraFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 20 },
  cameraHint: { fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  captureBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)' },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  permDenied: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permDeniedText: { color: '#fff', textAlign: 'center', fontSize: 15, lineHeight: 22 },
  ovalContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  oval: { width: SCREEN_WIDTH * 0.65, height: SCREEN_WIDTH * 0.85, borderRadius: SCREEN_WIDTH * 0.5, borderWidth: 3 },

  // Searching
  centeredScreen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  searchingText: { fontSize: 15, color: Colors.textMuted, textAlign: 'center' },

  // Results header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  backText: { fontSize: 24, color: Colors.textMuted },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 2 },
  headerSubLine: { fontSize: 12, color: '#666', textAlign: 'center' },

  // Action row — matches event screen button style
  // Search again / Download Photos row → shared components/PhotoActionRow.tsx (2026-11-10).

  // Select bar — matches event screen
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: Colors.background, gap: 8 },
  selectCount: { fontSize: 22, fontWeight: '500', color: Colors.white, lineHeight: 24 },
  selectBarBtns: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  selBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selBtnText: { fontSize: 13, color: Colors.textMuted },

  // Section + date headers
  sectionHeader: { backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  // ⚠ Copied from event.tsx's sectionTitleRow / sectionTitle / sectionCount /
  // sectionSub. The Event screen is the master — if it changes, change these
  // and guest-uploads.tsx to match.
  galleryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  // at the user's request, 2026-10-17. Change one, change the other.
  galleryTitle: { ...Typography.sectionHeading, color: Colors.white },
  galleryCount: { fontSize: 14, color: '#888' },
  gallerySub: { fontSize: 13, color: '#666' },
  dateHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 18, paddingBottom: 8, backgroundColor: Colors.background, gap: 10 },
  dateHeaderText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  dateHeaderCircle: { padding: 2 },
  groupCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  groupCircleSelected: { backgroundColor: Colors.background, borderColor: Colors.white },
  groupCircleTick: { fontSize: 11, fontWeight: '800', color: Colors.white },

  // Photo grid
  photoRow: { flexDirection: 'row', paddingHorizontal: GAP, marginBottom: GAP },
  thumbWrap: { overflow: 'hidden' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE },
  thumbPlaceholder: { width: THUMB_SIZE, height: THUMB_SIZE, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  checkbox: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: Colors.background, borderColor: Colors.white },
  checkboxTick: { fontSize: 11, fontWeight: '800', color: Colors.white },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 20 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  retryBtn: { borderWidth: 1.5, borderColor: Colors.accent, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: Colors.accent },

  // Lightbox
  lightboxInner: { flex: 1, backgroundColor: '#000' },
  lbHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  // Built from lbBtn so it can never drift from the other buttons. Every number
  // here matches event.tsx — read the comment there before changing any of it.
  lbClose: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 2 },
  // The copy drawn on the busy cover. Matches event.tsx.
  lbCloseOnCover: { position: 'absolute', right: 16, marginLeft: 0 },
  lbCloseText: { fontSize: 26, lineHeight: 26, color: '#888', includeFontPadding: false, textAlign: 'center' },
  lbCounter: { fontSize: 13, color: '#666', flex: 1 },
  lbActions: { flexDirection: 'row', gap: 8 },
  lbBtn: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 },
  // lineHeight pinned so every chip in the row is 31 tall by arithmetic rather
  // than font metrics. Matches event.tsx.
  lbBtnText: { fontSize: 13, fontWeight: '500', color: '#888', lineHeight: 18 },
  lbImg: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lbImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' },
  lbArrowText: { fontSize: 36, color: 'rgba(255,255,255,0.35)' },
  lbFooter: { paddingHorizontal: 16, paddingTop: 10 },
  lbFooterLine1: { fontSize: 13, color: '#ccc', marginBottom: 2 },
  lbFooterLine2: { fontSize: 12, color: '#888' },
});
