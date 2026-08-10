import React, { useState, useEffect, memo, forwardRef, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Modal, ActivityIndicator,
  Image, Dimensions, Platform, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import {
  Gesture, GestureDetector, GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
try { PhotoSaver = require('photo-saver').default; } catch {}
import { getEventPhotos, getPhotoUrls, deletePhotos, prepareZip } from '../lib/api';
import { buildDownloadFilename } from '../lib/downloadFilename';
import { API_BASE_URL } from '../constants/config';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert } from '../lib/useAlert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GAP = 2;
const THUMB_SIZE = (SCREEN_WIDTH - GAP * 2) / 3;
const JPG_LIMIT = 40;

type GuestPhotoItem = {
  id: string;
  takenAt: string;
  date: string;
  thumbUrl: string | null;
  fullUrl: string | null;
};

export type GuestUploadsGuest = {
  mobile: string;
  name: string;
  role: 'organiser' | 'coadmin' | 'user';
  contactName: string | null;
};

interface Props {
  visible: boolean;
  guest: GuestUploadsGuest | null;
  onClose: () => void;
  eventSlug: string;
  adminPhone: string;
  viewerRole: 'organiser' | 'coadmin';
  onPhotosDeleted: (mobile: string, remainingCount: number) => void;
}

type ListItem =
  | { type: 'gallery_header'; key: string }
  | { type: 'date_header'; date: string; key: string }
  | { type: 'photo_row'; photos: GuestPhotoItem[]; startIndex: number; key: string };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

type ThumbProps = {
  photoId: string;
  flatIndex: number;
  thumbUrl: string | null;
  isSelected: boolean;
  mode: 'normal' | 'delete' | 'download';
  onPress: (photoId: string, flatIndex: number) => void;
  onLongPress: (photoId: string) => void;
};

const PhotoThumb = memo(forwardRef<View, ThumbProps>(function PhotoThumb({
  photoId, flatIndex, thumbUrl, isSelected, mode, onPress, onLongPress,
}, ref) {
  return (
    <TouchableOpacity
      ref={ref as any}
      style={styles.thumb}
      onPress={() => onPress(photoId, flatIndex)}
      onLongPress={() => onLongPress(photoId)}
      delayLongPress={350}
      activeOpacity={0.85}
    >
      {thumbUrl
        ? <ExpoImage source={{ uri: thumbUrl }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photoId} />
        : <View style={styles.thumbSkeleton} />
      }
      {mode !== 'normal' && (
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
}));
PhotoThumb.displayName = 'PhotoThumb';

export default function GuestUploadsPanel({ visible, guest, onClose, eventSlug, adminPhone, viewerRole, onPhotosDeleted }: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();

  const [photos, setPhotos] = useState<GuestPhotoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'normal' | 'delete' | 'download'>('normal');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);
  const imageLoadingRef = useRef(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [downloadingPhoto, setDownloadingPhoto] = useState(false);
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const prevSelectedSize = useRef(0);

  // Refs for drag-to-select
  const photoRefsMap = useRef<Map<string, any>>(new Map());
  const flatListContainerRef = useRef<any>(null);
  const flatListLayoutRef = useRef({ x: 0, y: 0 });
  const scrollOffsetRef = useRef(0);
  const accumulatedHeights = useRef<Record<string, number>>({});
  const listDataRef = useRef<ListItem[]>([]);
  const dragAnchorIndexRef = useRef<number | null>(null);
  const dragModeRef = useRef<'select' | 'deselect' | null>(null);
  const committedSelectionRef = useRef<Set<string>>(new Set());
  const longPressAnchorRef = useRef<{ anchorFlatIndex: number; anchorContentY: number } | null>(null);

  // Zoom shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // JPG limit warning
  useEffect(() => {
    if (mode !== 'download') { prevSelectedSize.current = selected.size; return; }
    if (prevSelectedSize.current <= JPG_LIMIT && selected.size > JPG_LIMIT) {
      showAlert(
        'Downloading as ZIP',
        `You've selected more than ${JPG_LIMIT} photos. When you tap Download, all selected photos will be bundled into a ZIP file — not downloaded as individual JPGs.\n\nTo download as individual JPGs instead, select ${JPG_LIMIT} or fewer photos.`,
        [{ text: 'Got it' }]
      );
    }
    prevSelectedSize.current = selected.size;
  }, [selected.size, mode]);

  // Reset on panel open
  useEffect(() => {
    if (!visible || !guest) return;
    setMode('normal');
    setSelected(new Set());
    setLightboxVisible(false);
    longPressAnchorRef.current = null;
    fetchPhotos();
  }, [visible, guest?.mobile]);

  // Reset imageLoading when lightbox photo changes
  useEffect(() => {
    if (lightboxVisible) {
      imageLoadingRef.current = true;
      setImageLoading(true);
    }
  }, [lightboxIndex, lightboxVisible]);

  // Reset zoom when lightbox photo changes
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [lightboxIndex]);

  async function fetchPhotos(): Promise<number> {
    if (!guest) return 0;
    setLoading(true);
    setError(null);
    try {
      const data = await getEventPhotos(eventSlug, adminPhone);
      const all = [...(data.photos ?? []), ...(data.otherPhotos ?? [])] as { id: string; taken_at: string; uploaded_by_mobile: string | null }[];
      const mine = all.filter(p => p.uploaded_by_mobile === guest.mobile);
      mine.sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());

      if (mine.length === 0) {
        setPhotos([]);
        setLoading(false);
        return 0;
      }

      const ids = mine.map(p => p.id);
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
      const urlResults = await Promise.all(batches.map(b => getPhotoUrls(eventSlug, b, adminPhone)));
      const urls: Record<string, { thumbUrl?: string; url?: string }> = Object.assign({}, ...urlResults.map(r => r.urls ?? {}));

      const items: GuestPhotoItem[] = mine.map(p => ({
        id: p.id,
        takenAt: p.taken_at,
        date: formatDate(p.taken_at),
        thumbUrl: urls[p.id]?.thumbUrl ?? null,
        fullUrl: urls[p.id]?.url ?? null,
      }));
      setPhotos(items);
      return items.length;
    } catch {
      setError('Failed to load photos.');
      return 0;
    } finally {
      setLoading(false);
    }
  }

  const listItems = useMemo((): ListItem[] => {
    const items: ListItem[] = [];
    items.push({ type: 'gallery_header', key: 'gallery_header' });

    const groups: { date: string; photos: GuestPhotoItem[] }[] = [];
    for (const photo of photos) {
      const existing = groups.find(g => g.date === photo.date);
      if (existing) existing.photos.push(photo);
      else groups.push({ date: photo.date, photos: [photo] });
    }

    let flatIndex = 0;
    for (const group of groups) {
      items.push({ type: 'date_header', date: group.date, key: `date_${group.date}` });
      const rows = chunk(group.photos, 3);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        items.push({ type: 'photo_row', photos: row, startIndex: flatIndex, key: `row_${group.date}_${r}` });
        flatIndex += row.length;
      }
    }

    listDataRef.current = items;
    return items;
  }, [photos]);

  const flatListExtraData = useMemo(() => ({ selected, mode }), [selected, mode]);

  const lightboxImageUrl = photos[lightboxIndex]?.fullUrl ?? photos[lightboxIndex]?.thumbUrl ?? null;
  const showDeleteBtn = viewerRole === 'organiser' || guest?.role === 'user' || guest?.mobile === adminPhone;

  // Lightbox zoom gestures
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const lbPanGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else {
        if (Math.abs(e.translationX) > 50 && Math.abs(e.translationX) > Math.abs(e.translationY)) {
          if (e.translationX < 0) runOnJS(navigateLightbox)(1);
          else runOnJS(navigateLightbox)(-1);
        }
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const zoomGesture = Gesture.Simultaneous(doubleTapGesture, lbPanGesture, pinchGesture);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  function navigateLightbox(delta: number) {
    setLightboxIndex(prev => {
      const next = prev + delta;
      if (next < 0 || next >= photos.length) return prev;
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === photos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(photos.map(p => p.id)));
    }
  }

  function cancelMode() {
    setMode('normal');
    setSelected(new Set());
    longPressAnchorRef.current = null;
  }

  function getPhotoIndexAtPosition(absX: number, absY: number): number | null {
    if (!longPressAnchorRef.current) return null;

    const fingerContentY = absY - flatListLayoutRef.current.y + scrollOffsetRef.current;
    const contentX = absX - flatListLayoutRef.current.x;
    const col = Math.min(Math.max(Math.floor(contentX / (THUMB_SIZE + GAP)), 0), 2);

    let cumY = 0;
    let photoFlatIndex = 0;

    for (const item of listDataRef.current) {
      const h = accumulatedHeights.current[item.key] ?? (item.type === 'photo_row' ? THUMB_SIZE + GAP : 0);
      if (item.type === 'photo_row') {
        if (fingerContentY >= cumY && fingerContentY < cumY + h) {
          return Math.min(photoFlatIndex + col, photoFlatIndex + item.photos.length - 1);
        }
        photoFlatIndex += item.photos.length;
      }
      cumY += h;
    }
    return null;
  }

  function getPhotoIdAtFlatIndex(index: number): string | null {
    let flatIndex = 0;
    for (const item of listDataRef.current) {
      if (item.type === 'photo_row') {
        if (index < flatIndex + item.photos.length) {
          return item.photos[index - flatIndex].id;
        }
        flatIndex += item.photos.length;
      }
    }
    return null;
  }

  function applyDragRange(anchorIndex: number, currentIndex: number, dragMode: 'select' | 'deselect') {
    const lo = Math.min(anchorIndex, currentIndex);
    const hi = Math.max(anchorIndex, currentIndex);
    const next = new Set(committedSelectionRef.current);
    for (let i = lo; i <= hi; i++) {
      const id = getPhotoIdAtFlatIndex(i);
      if (id) { if (dragMode === 'select') next.add(id); else next.delete(id); }
    }
    setSelected(next);
  }

  function setAnchorForPhoto(photoId: string) {
    let flatIndex = 0;
    let found = false;
    for (const item of listDataRef.current) {
      if (item.type === 'photo_row') {
        const idx = item.photos.findIndex(p => p.id === photoId);
        if (idx >= 0) {
          flatIndex += idx;
          found = true;
          break;
        }
        flatIndex += item.photos.length;
      }
    }
    if (!found) return;
    const ref = photoRefsMap.current.get(photoId);
    if (!ref) return;
    ref.measureInWindow((x: number, y: number) => {
      const contentY = y - flatListLayoutRef.current.y + scrollOffsetRef.current;
      longPressAnchorRef.current = { anchorFlatIndex: flatIndex, anchorContentY: contentY };
    });
  }

  const onDragStart = useCallback((absX: number, absY: number) => {
    if (!longPressAnchorRef.current) return;
    committedSelectionRef.current = new Set(selected);
    const index = getPhotoIndexAtPosition(absX, absY);
    if (index === null) return;
    const anchorId = getPhotoIdAtFlatIndex(index);
    const dragMode = anchorId && committedSelectionRef.current.has(anchorId) ? 'deselect' : 'select';
    dragAnchorIndexRef.current = index;
    dragModeRef.current = dragMode;
    applyDragRange(index, index, dragMode);
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

  const dragGesture = useMemo(() => Gesture.Pan()
    .enabled(mode !== 'normal')
    .activeOffsetX([-8, 8])
    .onStart((e) => { 'worklet'; runOnJS(onDragStart)(e.absoluteX, e.absoluteY); })
    .onUpdate((e) => { 'worklet'; runOnJS(onDragUpdate)(e.absoluteX, e.absoluteY); })
    .onFinalize(() => { 'worklet'; runOnJS(onDragEnd)(); })
  , [mode, onDragStart, onDragUpdate, onDragEnd]);

  const handleThumbPress = useCallback((photoId: string, flatIndex: number) => {
    if (mode !== 'normal') {
      if (!longPressAnchorRef.current) setAnchorForPhoto(photoId);
      toggleSelect(photoId);
    } else {
      setLightboxIndex(flatIndex);
      setLightboxVisible(true);
    }
  }, [mode]);

  const handleThumbLongPress = useCallback((photoId: string) => {
    if (mode === 'normal') {
      setMode('download');
      setAnchorForPhoto(photoId);
      toggleSelect(photoId);
    }
  }, [mode]);

  function handleScroll(e: any) {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }

  async function handleLightboxDelete(photoId: string) {
    showAlert(
      'Delete photo',
      'Delete this photo? This cannot be undone.',
      [
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeletingPhoto(true);
            try {
              const result = await deletePhotos(eventSlug, [photoId], undefined, undefined, undefined, adminPhone);
              if (result.error) { showAlert('Error', result.error); return; }
              const newPhotos = photos.filter(p => p.id !== photoId);
              if (newPhotos.length === 0) {
                setLightboxVisible(false);
              } else {
                setLightboxIndex(prev => Math.min(prev, newPhotos.length - 1));
              }
              setPhotos(newPhotos);
              if (guest) onPhotosDeleted(guest.mobile, newPhotos.length);
            } finally {
              setDeletingPhoto(false);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function handleLightboxDownload() {
    const photo = photos[lightboxIndex];
    if (!photo) return;
    setDownloadingPhoto(true);
    try {
      const filename = buildDownloadFilename(photo.id, photo.takenAt ?? null, 'jpg');
      const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
      const downloadUrl = `${API_BASE_URL}/api/native/photos/${photo.id}/download${adminParam}`;
      const dateTakenMs = photo.takenAt ? new Date(photo.takenAt).getTime() : 0;
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      if (Platform.OS === 'android') {
        const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${eventSlug}`) ?? eventSlug;
        const localPath = dlResult.uri.replace('file://', '');
        await MediaStore.saveToDownloads(localPath, filename, folderName, 'image/jpeg', dateTakenMs);
      } else {
        if (PhotoSaver) {
          await PhotoSaver.saveToPhotos(cacheUri, dateTakenMs, eventSlug);
        } else {
          await MediaLibrary.saveToLibraryAsync(cacheUri);
        }
      }
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
      showAlert('Downloaded', Platform.OS === 'ios' ? 'Photo saved to your Photos.' : 'Photo saved to Downloads.');
    } catch (e: any) {
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setDownloadingPhoto(false);
    }
  }

  async function handleLightboxShare() {
    const photo = photos[lightboxIndex];
    if (!photo) return;
    setSharingPhoto(true);
    try {
      const filename = buildDownloadFilename(photo.id, photo.takenAt ?? null, 'jpg');
      const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
      const downloadUrl = `${API_BASE_URL}/api/native/photos/${photo.id}/download${adminParam}`;
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      await Sharing.shareAsync(cacheUri, { mimeType: 'image/jpeg', dialogTitle: 'Share Photo' });
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    } catch (e: any) {
      showAlert('Error', `Share failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setSharingPhoto(false);
    }
  }

  async function handleDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    showAlert(
      'Delete photos',
      `Delete ${ids.length} photo${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const result = await deletePhotos(eventSlug, ids, undefined, undefined, undefined, adminPhone);
              if (result.error) { showAlert('Error', result.error); return; }
              setMode('normal');
              setSelected(new Set());
              const remaining = await fetchPhotos();
              if (guest) onPhotosDeleted(guest.mobile, remaining);
            } finally {
              setActionLoading(false);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function handleDownload() {
    const ids = [...selected];
    if (ids.length === 0) return;

    if (ids.length > JPG_LIMIT) {
      showAlert(
        `Download ${ids.length} photos as ZIP`,
        `${Math.ceil(ids.length / 50)} ZIP file${Math.ceil(ids.length / 50) > 1 ? 's' : ''} will be saved to your Downloads folder.`,
        [
          { text: 'Download', onPress: () => doDownloadZip(ids) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    showAlert(
      'How would you like to download?',
      undefined,
      [
        { text: 'Save as JPG', onPress: () => doDownloadJpgs(ids) },
        { text: 'Save as ZIP', onPress: () => doDownloadZip(ids) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function doDownloadZip(ids: string[]) {
    setActionLoading(true);
    try {
      const BATCH_SIZE = 50;
      const batches = chunk(ids, BATCH_SIZE);
      for (let i = 0; i < batches.length; i++) {
        const batchIds = batches[i];
        const filename = batches.length > 1
          ? `${eventSlug}-photos-part${i + 1}of${batches.length}.zip`
          : `${eventSlug}-photos.zip`;
        const zipRes = await prepareZip(eventSlug, batchIds, adminPhone);
        if (zipRes.error) throw new Error(zipRes.error);
        await saveZip(filename, zipRes.zipUrl);
      }
      setMode('normal');
      setSelected(new Set());
      const msg = Platform.OS === 'ios'
        ? (batches.length > 1 ? `${batches.length} ZIPs shared.` : 'ZIP shared.')
        : (batches.length > 1 ? `${batches.length} ZIPs saved to Downloads.` : 'ZIP saved to Downloads.');
      showAlert('Download complete', msg);
    } catch (e: any) {
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function doDownloadJpgs(ids: string[]) {
    setActionLoading(true);
    try {
      const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${eventSlug}`) ?? eventSlug;
      let saved = 0;
      let failed = 0;

      for (const id of ids) {
        try {
          const photo = photos.find(p => p.id === id);
          const filename = buildDownloadFilename(id, photo?.takenAt ?? null, 'jpg');
          const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
          const downloadUrl = `${API_BASE_URL}/api/native/photos/${id}/download${adminParam}`;
          const dateTakenMs = photo?.takenAt ? new Date(photo.takenAt).getTime() : 0;
          const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
          const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
          if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
          if (Platform.OS === 'android') {
            const localPath = dlResult.uri.replace('file://', '');
            await MediaStore.saveToDownloads(localPath, filename, folderName, 'image/jpeg', dateTakenMs);
          } else {
            if (PhotoSaver) {
              await PhotoSaver.saveToPhotos(cacheUri, dateTakenMs, eventSlug);
            } else {
              await MediaLibrary.saveToLibraryAsync(cacheUri);
            }
          }
          await FileSystem.deleteAsync(cacheUri, { idempotent: true });
          saved++;
        } catch { failed++; }
      }

      setMode('normal');
      setSelected(new Set());
      const msg = Platform.OS === 'ios'
        ? `${saved} JPG${saved !== 1 ? 's' : ''} saved to your Photos.`
        : `${saved} JPG${saved !== 1 ? 's' : ''} saved to Downloads.`;
      showAlert('Download complete', msg);
    } catch (e: any) {
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function saveZip(filename: string, url: string): Promise<void> {
    const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
    const dlResult = await FileSystem.downloadAsync(url, cacheUri);
    if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
    if (Platform.OS === 'android') {
      const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${eventSlug}`) ?? eventSlug;
      const localPath = dlResult.uri.replace('file://', '');
      await MediaStore.saveToDownloads(localPath, filename, folderName, 'application/zip');
    } else {
      await Sharing.shareAsync(cacheUri, { mimeType: 'application/zip', dialogTitle: 'Save ZIP' });
    }
    await FileSystem.deleteAsync(cacheUri, { idempotent: true });
  }

  function renderActionRow() {
    if (mode === 'normal') {
      return (
        <View style={styles.btnRow}>
          {showDeleteBtn && (
            <TouchableOpacity style={styles.deleteBtn} onPress={() => setMode('delete')}>
              <Text style={styles.deleteBtnText}>Delete Photos</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.downloadBtn} onPress={() => setMode('download')}>
            <Text style={styles.downloadBtnText}>Download Photos</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const isDelete = mode === 'delete';
    return (
      <View style={styles.selectBar}>
        <Text style={styles.selectCount}>{selected.size}</Text>
        <View style={styles.selectBarBtns}>
          <Pressable style={styles.selBtn} onPress={selectAll}>
            <Text style={styles.selBtnText}>Select all</Text>
          </Pressable>
          <Pressable style={styles.selBtn} onPress={cancelMode}>
            <Text style={styles.selBtnText}>Cancel</Text>
          </Pressable>
          {actionLoading ? (
            <ActivityIndicator size="small" color={isDelete ? Colors.danger : Colors.accent} />
          ) : (
            <Pressable
              style={[styles.selBtn, { borderColor: isDelete ? Colors.danger : Colors.accent }, selected.size === 0 && { opacity: 0.4 }]}
              onPress={isDelete ? handleDelete : handleDownload}
              disabled={selected.size === 0}
            >
              <Text style={[styles.selBtnText, { color: isDelete ? Colors.danger : Colors.accent }]}>
                {isDelete ? 'Delete' : 'Download'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  function renderItem({ item }: { item: ListItem }) {
    return (
      <View onLayout={(e) => {
        accumulatedHeights.current[item.key] = e.nativeEvent.layout.height;
      }}>
        {renderItemContent(item)}
      </View>
    );
  }

  function renderItemContent(item: ListItem) {
    if (item.type === 'gallery_header') {
      return (
        <View>
          <View style={styles.galleryHeading}>
            <Text style={styles.galleryTitle}>Photo Gallery <Text style={styles.galleryCount}>{photos.length}</Text></Text>
          </View>
          <Text style={styles.gallerySub}>(grouped by date · oldest first)</Text>
        </View>
      );
    }
    if (item.type === 'date_header') {
      return <Text style={styles.dateHeader}>{item.date}</Text>;
    }
    if (item.type === 'photo_row') {
      return (
        <View style={styles.photoRow}>
          {item.photos.map((photo, colIdx) => (
            <PhotoThumb
              key={photo.id}
              ref={(r: any) => {
                if (r) photoRefsMap.current.set(photo.id, r);
                else photoRefsMap.current.delete(photo.id);
              }}
              photoId={photo.id}
              flatIndex={item.startIndex + colIdx}
              thumbUrl={photo.thumbUrl}
              isSelected={selected.has(photo.id)}
              mode={mode}
              onPress={handleThumbPress}
              onLongPress={handleThumbLongPress}
            />
          ))}
          {item.photos.length < 3 && Array.from({ length: 3 - item.photos.length }).map((_, i) => (
            <View key={`empty-${i}`} style={[styles.thumb, { backgroundColor: 'transparent' }]} />
          ))}
        </View>
      );
    }
    return null;
  }

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => {
          if (lightboxVisible) { setLightboxVisible(false); return; }
          if (mode !== 'normal') { cancelMode(); return; }
          onClose();
        }}
      >
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={{ paddingTop: insets.top }}>
            <View style={styles.eventHeader}>
              <View style={styles.eventHeaderTopRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity onPress={() => {
                    if (mode !== 'normal') { cancelMode(); return; }
                    onClose();
                  }}>
                    <Text style={styles.backText}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.appNameText}>Guest Uploads</Text>
                </View>
              </View>
              <View style={styles.eventHeaderBody}>
                <Text style={styles.guestName} numberOfLines={1}>{guest?.name || guest?.mobile}</Text>
                <Text style={styles.guestContactLine}>{guest?.contactName ?? 'Number not in contacts'}</Text>
                <Text style={styles.guestMetaLine}>{guest?.mobile}{photos.length > 0 ? ` · ${photos.length} photo${photos.length !== 1 ? 's' : ''}` : ''}</Text>
              </View>
            </View>
          </View>

          {!loading && !error && photos.length > 0 && renderActionRow()}

          {loading ? (
            <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.centerBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => fetchPhotos()} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : photos.length === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>No photos uploaded yet.</Text>
            </View>
          ) : (
            <View
              ref={flatListContainerRef}
              style={{ flex: 1 }}
              onLayout={() => {
                flatListContainerRef.current?.measure((_x: number, _y: number, _w: number, _h: number, pageX: number, pageY: number) => {
                  flatListLayoutRef.current = { x: pageX, y: pageY };
                });
              }}
            >
              <GestureDetector gesture={dragGesture}>
                <FlashList
                  data={listItems}
                  keyExtractor={item => item.key}
                  renderItem={renderItem}
                  extraData={flatListExtraData}
                  estimatedItemSize={THUMB_SIZE + GAP}
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
                />
              </GestureDetector>
            </View>
          )}

          {alertOverlay}
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={lightboxVisible}
        animationType="fade"
        onRequestClose={() => setLightboxVisible(false)}
      >
        <GestureHandlerRootView style={styles.lightboxInner}>
          <View style={[styles.lbHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setLightboxVisible(false)}>
              <Text style={styles.lbBack}>←</Text>
            </TouchableOpacity>
            <Text style={styles.lbCounter}>{lightboxIndex + 1} / {photos.length}</Text>
            <View style={styles.lbActions}>
              {showDeleteBtn && (
                <TouchableOpacity
                  style={[styles.lbBtn, styles.lbBtnDanger]}
                  onPress={() => { const p = photos[lightboxIndex]; if (p) handleLightboxDelete(p.id); }}
                >
                  <Text style={[styles.lbBtnText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.lbBtn} onPress={handleLightboxDownload} disabled={downloadingPhoto || sharingPhoto}>
                <Text style={styles.lbBtnText}>Download</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.lbBtn} onPress={handleLightboxShare} disabled={downloadingPhoto || sharingPhoto}>
                <Text style={styles.lbBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={[styles.lbImgWrap, { overflow: 'hidden' }]}>
            <GestureDetector gesture={zoomGesture}>
              <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }, zoomStyle]}>
                {lightboxImageUrl
                  ? <Image
                      source={{ uri: lightboxImageUrl }}
                      style={styles.lbImg}
                      resizeMode="contain"
                      onLoad={() => { imageLoadingRef.current = false; setImageLoading(false); }}
                    />
                  : null
                }
              </Animated.View>
            </GestureDetector>
            {(!lightboxImageUrl || imageLoading) && (
              <ActivityIndicator color={Colors.accent} style={StyleSheet.absoluteFill} />
            )}
            {deletingPhoto && (
              <View style={styles.lbDeletingOverlay}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={styles.lbDeletingText}>Deleting...</Text>
              </View>
            )}
            {lightboxIndex > 0 && !imageLoading && (
              <TouchableOpacity style={[styles.lbArrow, { left: 0 }]} onPress={() => navigateLightbox(-1)}>
                <Text style={styles.lbArrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {lightboxIndex < photos.length - 1 && !imageLoading && (
              <TouchableOpacity style={[styles.lbArrow, { right: 0 }]} onPress={() => navigateLightbox(1)}>
                <Text style={styles.lbArrowText}>›</Text>
              </TouchableOpacity>
            )}
          </View>
          {downloadingPhoto && (
            <View style={styles.lbDownloadOverlay}>
              <ActivityIndicator color={Colors.white} size="large" />
              <Text style={styles.lbDownloadText}>Downloading…</Text>
            </View>
          )}
          {sharingPhoto && (
            <View style={styles.lbDownloadOverlay}>
              <ActivityIndicator color={Colors.white} size="large" />
              <Text style={styles.lbDownloadText}>Preparing…</Text>
            </View>
          )}
          {alertOverlay}
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Header
  eventHeader: { paddingTop: 16, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  eventHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backText: { fontSize: 24, color: Colors.textMuted },
  appNameText: { fontSize: 18, fontWeight: '800', color: Colors.white, letterSpacing: 0.3 },
  eventHeaderBody: { alignItems: 'center' },
  guestName: { fontSize: 18, fontWeight: '600', color: Colors.white, textAlign: 'center' },
  guestContactLine: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 2 },
  guestMetaLine: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 2 },

  // Normal mode buttons
  btnRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  deleteBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.danger, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  deleteBtnText: { ...Typography.buttonText, color: Colors.danger },
  downloadBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 'auto' as any },
  downloadBtnText: { ...Typography.buttonText, color: Colors.background },

  // Select bar
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.background, gap: 8 },
  selectCount: { fontSize: 22, fontWeight: '500', color: Colors.white, lineHeight: 24 },
  selectBarBtns: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  selBtn: { borderWidth: 0.5, borderColor: '#333', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selBtnText: { fontSize: 13, color: Colors.textMuted },

  // Gallery
  galleryHeading: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 },
  galleryTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  galleryCount: { fontSize: 16, fontWeight: '400', color: '#777' },
  gallerySub: { fontSize: 12, color: '#555', paddingHorizontal: 16, marginBottom: 8 },
  dateHeader: { fontSize: 14, fontWeight: '700', color: Colors.white, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  photoRow: { flexDirection: 'row', gap: GAP, marginTop: GAP },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, backgroundColor: '#1a1a1a' },
  thumbImage: { width: '100%', height: '100%' },
  thumbSkeleton: { flex: 1, backgroundColor: '#252525' },
  checkbox: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: Colors.background, borderColor: Colors.white },
  checkboxTick: { fontSize: 11, fontWeight: '800', color: Colors.white },

  // States
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 12 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 0.5, borderColor: '#333' },
  retryBtnText: { fontSize: 13, color: Colors.textMuted },

  // Lightbox — matches event.tsx verbatim
  lightboxInner: { flex: 1, backgroundColor: '#000' },
  lbHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  lbBack: { fontSize: 22, color: Colors.textMuted, marginRight: 12 },
  lbCounter: { fontSize: 13, color: '#666', flex: 1 },
  lbActions: { flexDirection: 'row', gap: 8 },
  lbBtn: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 },
  lbBtnDanger: { borderColor: 'rgba(229,57,53,0.3)' },
  lbBtnText: { fontSize: 13, fontWeight: '500', color: '#888' },
  lbImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  lbImg: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' },
  lbArrowText: { fontSize: 36, color: 'rgba(255,255,255,0.35)' },
  lbDeletingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  lbDeletingText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  lbDownloadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10, justifyContent: 'center', alignItems: 'center', gap: 12 },
  lbDownloadText: { color: Colors.white, fontSize: 14, fontWeight: '500' },
});
