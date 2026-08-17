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
import { FlashList } from '@shopify/flash-list';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
try { PhotoSaver = require('photo-saver').default; } catch {}
import { findMyPhotos, getPhotoUrls, prepareZip } from '../lib/api';
import { buildDownloadFilename } from '../lib/downloadFilename';
import { API_BASE_URL } from '../constants/config';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert } from '../lib/useAlert';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const OVAL_W = SCREEN_WIDTH * 0.65;
const OVAL_H = SCREEN_WIDTH * 0.85;
const COLS = 3;
const GAP = 2;
const THUMB_SIZE = Math.floor((SCREEN_WIDTH - GAP * (COLS + 1)) / COLS);
const JPG_LIMIT = 40;
const PRIVACY_KEY = 'myPhotosPrivacySeen';

type Photo = { id: string; taken_at: string; uploaded_by_name?: string };
type PhotoUrls = { url?: string; thumbUrl?: string; displayUrl?: string };
type Mode = 'camera' | 'searching' | 'results';

type ListItem =
  | { type: 'section_header'; label: string; key: string }
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
        ? <ExpoImage source={{ uri: thumbUrl }} style={{ width: THUMB_SIZE, height: THUMB_SIZE }} contentFit="cover" recyclingKey={id} />
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
    eventName: string; totalPhotos: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [mode, setMode] = useState<Mode>('camera');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [otherPhotos, setOtherPhotos] = useState<Photo[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, PhotoUrls>>({});
  const [capturing, setCapturing] = useState(false);
  const [downloadMode, setDownloadMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
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
  const prevSelectedSize = useRef(0);

  // Lightbox zoom shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const listDataRef = useRef<ListItem[]>([]);

  const slug = params.slug;
  const eventName = params.eventName || slug;
  const adminPhone = params.adminPhone || undefined;
  const userMobile = params.userMobile || undefined;
  const totalPhotos = parseInt(params.totalPhotos ?? '0', 10);

  const allIds = useMemo(() => [
    ...photos.map(p => p.id),
    ...otherPhotos.map(p => p.id),
  ], [photos, otherPhotos]);

  const totalFound = allIds.length;

  const listItems = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    if (photos.length > 0) {
      items.push({ type: 'section_header', label: 'Photo Gallery', key: 'header_main' });
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
      items.push({ type: 'section_header', label: 'Other Photos Gallery', key: 'header_other' });
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
  }, [photos, otherPhotos]);

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

  // Reset zoom whenever lightbox photo changes
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [lightboxIndex]);

  function navigateLightbox(dir: number) {
    setLightboxIndex(prev => {
      const next = prev + dir;
      if (next < 0 || next >= totalFound) return prev;
      return next;
    });
  }

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

  const dragGesture = useMemo(() => Gesture.Pan()
    .enabled(downloadMode)
    .activeOffsetX([-8, 8])
    .onStart((e) => { 'worklet'; runOnJS(onDragStart)(e.absoluteX, e.absoluteY); })
    .onUpdate((e) => { 'worklet'; runOnJS(onDragUpdate)(e.absoluteX, e.absoluteY); })
    .onFinalize(() => { 'worklet'; runOnJS(onDragEnd)(); })
  , [downloadMode, onDragStart, onDragUpdate, onDragEnd]);

  useEffect(() => {
    if (downloadMode && prevSelectedSize.current <= JPG_LIMIT && selected.size > JPG_LIMIT) {
      showAlert(
        'Downloading as ZIP',
        `You've selected more than ${JPG_LIMIT} photos. When you tap Download, all selected photos will be bundled into a ZIP file — not downloaded as individual JPGs.\n\nTo download as individual JPGs instead, select ${JPG_LIMIT} or fewer photos.`,
        [{ text: 'Got it' }]
      );
    }
    prevSelectedSize.current = selected.size;
  }, [selected.size, downloadMode]);

  async function handleLightboxDownload() {
    const id = allIds[lightboxIndex];
    if (!id) return;
    showAlert('Download photo', 'Save this photo to your Downloads folder?', [
      {
        text: 'Download', onPress: async () => {
          setActionLoading(true);
          try {
            const photo = [...photos, ...otherPhotos].find(p => p.id === id);
            const filename = buildDownloadFilename(id, photo?.taken_at ?? null, 'jpg');
            const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
            const downloadUrl = `${API_BASE_URL}/api/native/photos/${id}/download${adminParam}`;
            const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
            const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
            if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
            if (Platform.OS === 'android') {
              let folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`);
              if (!folderName) {
                folderName = eventName;
                await SecureStore.setItemAsync(`downloads_folder_name_${slug}`, folderName);
              }
              const localPath = dlResult.uri.replace('file://', '');
              await MediaStore.saveToDownloads(localPath, filename, folderName, 'image/jpeg', 0);
            } else {
              if (PhotoSaver) {
                await PhotoSaver.saveToPhotos(cacheUri, 0, eventName);
              } else {
                await MediaLibrary.saveToLibraryAsync(cacheUri);
              }
            }
            await FileSystem.deleteAsync(cacheUri, { idempotent: true });
            showAlert('Downloaded', Platform.OS === 'ios' ? 'Photo saved to your Photos.' : 'Photo saved to Downloads.');
          } catch (e: any) {
            showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
          } finally {
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
    try {
      const photo = [...photos, ...otherPhotos].find(p => p.id === id);
      const filename = buildDownloadFilename(id, photo?.taken_at ?? null, 'jpg');
      const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
      const downloadUrl = `${API_BASE_URL}/api/native/photos/${id}/download${adminParam}`;
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      await Sharing.shareAsync(cacheUri, { mimeType: 'image/jpeg', dialogTitle: 'Share Photo' });
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    } catch (e: any) {
      showAlert('Error', `Share failed: ${e?.message ?? 'unknown error'}`);
    } finally {
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
  useEffect(() => {
    async function init() {
      if (!permission?.granted) await requestPermission();
      const seen = await AsyncStorage.getItem(PRIVACY_KEY);
      if (!seen) {
        showAlert(
          'Your selfie is never saved',
          "Your selfie is only used to search this event's photos. It is never stored on our servers.",
          [{ text: 'Got it', onPress: async () => { await AsyncStorage.setItem(PRIVACY_KEY, '1'); } }]
        );
      }
    }
    init();
  }, []);

  async function handleTakeSelfie() {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current!.takePictureAsync({ quality: 0.9 });
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
      await activateKeepAwakeAsync();
      setMode('searching');
      const result = await findMyPhotos(slug, base64, adminPhone, userMobile);
      deactivateKeepAwake();
      if (result.error) {
        setCameraReady(false);
        showAlert('Error', result.error, [{ text: 'Try Again', onPress: () => setMode('camera') }]);
        setMode('camera');
        setCapturing(false);
        return;
      }
      const main = result.photos ?? [];
      const other = result.otherPhotos ?? [];
      setPhotos(main);
      setOtherPhotos(other);
      setMode('results');
      const ids = [...main.map(p => p.id), ...other.map(p => p.id)];
      if (ids.length > 0) loadUrls(ids);
    } catch (e: any) {
      deactivateKeepAwake();
      setCameraReady(false);
      showAlert('Error', e?.message ?? 'Something went wrong. Please try again.', [{ text: 'OK', onPress: () => setMode('camera') }]);
      setMode('camera');
    }
    setCapturing(false);
  }

  async function loadUrls(ids: string[]) {
    const batches = chunk(ids, 20);
    await Promise.all(batches.map(async (batch) => {
      try {
        const result = await getPhotoUrls(slug, batch, adminPhone);
        if (result.urls) setPhotoUrls(prev => ({ ...prev, ...result.urls }));
      } catch {}
    }));
  }

  async function handleDownload() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (ids.length > JPG_LIMIT) {
      showAlert(`Download ${ids.length} photos as ZIP`, `You've selected more than ${JPG_LIMIT} photos. They will be downloaded as a ZIP file.`, [
        { text: 'Download', onPress: () => doDownloadZip(ids) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    showAlert('How would you like to download?', undefined, [
      { text: 'Save as JPG', onPress: () => doDownloadJpgs(ids) },
      { text: 'Save as ZIP', onPress: () => doDownloadZip(ids) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function doDownloadJpgs(ids: string[]) {
    setActionLoading(true);
    try {
      let folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`);
      if (!folderName) {
        folderName = eventName;
        await SecureStore.setItemAsync(`downloads_folder_name_${slug}`, folderName);
      }
      let saved = 0;
      for (const id of ids) {
        try {
          const photo = [...photos, ...otherPhotos].find(p => p.id === id);
          const filename = buildDownloadFilename(id, photo?.taken_at ?? null, 'jpg');
          const adminParam = adminPhone ? `?adminPhone=${encodeURIComponent(adminPhone)}` : '';
          const downloadUrl = `${API_BASE_URL}/api/native/photos/${id}/download${adminParam}`;
          const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
          const dlResult = await FileSystem.downloadAsync(downloadUrl, cacheUri);
          if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
          if (Platform.OS === 'android') {
            const localPath = dlResult.uri.replace('file://', '');
            await MediaStore.saveToDownloads(localPath, filename, folderName, 'image/jpeg', 0);
          } else {
            if (PhotoSaver) {
              await PhotoSaver.saveToPhotos(cacheUri, 0, eventName);
            } else {
              await MediaLibrary.saveToLibraryAsync(cacheUri);
            }
          }
          await FileSystem.deleteAsync(cacheUri, { idempotent: true });
          saved++;
        } catch {}
      }
      exitDownloadMode();
      const msg = Platform.OS === 'ios'
        ? `${saved} photo${saved !== 1 ? 's' : ''} saved to your Photos.`
        : `${saved} photo${saved !== 1 ? 's' : ''} saved to Downloads.`;
      showAlert('Download complete', msg);
    } catch (e: any) {
      showAlert('Error', `Download failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function doDownloadZip(ids: string[]) {
    setActionLoading(true);
    try {
      const batches = chunk(ids, 50);
      for (let i = 0; i < batches.length; i++) {
        const filename = batches.length > 1
          ? `${slug}-photos-part${i + 1}of${batches.length}.zip`
          : `${slug}-photos.zip`;
        const zipRes = await prepareZip(slug, batches[i], adminPhone);
        if (zipRes.error) throw new Error(zipRes.error);
        const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
        const dlResult = await FileSystem.downloadAsync(zipRes.zipUrl, cacheUri);
        if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
        if (Platform.OS === 'android') {
          let folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`);
          if (!folderName) {
            folderName = eventName;
            await SecureStore.setItemAsync(`downloads_folder_name_${slug}`, folderName);
          }
          const localPath = dlResult.uri.replace('file://', '');
          await MediaStore.saveToDownloads(localPath, filename, folderName, 'application/zip');
        } else {
          await Sharing.shareAsync(cacheUri, { mimeType: 'application/zip', dialogTitle: 'Save ZIP' });
        }
        await FileSystem.deleteAsync(cacheUri, { idempotent: true });
      }
      exitDownloadMode();
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
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.camBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>My Photos</Text>
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
        <Text style={styles.searchingText}>Searching through {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}…</Text>
      </View>
    );
  }

  // ── Results screen ──────────────────────────────────────────────────────────
  const currentLbId = allIds[lightboxIndex];
  const currentLbUrls = photoUrls[currentLbId];
  const currentLbPhoto = lightboxIndex < photos.length ? photos[lightboxIndex] : otherPhotos[lightboxIndex - photos.length];
  const lightboxImageUrl = currentLbUrls?.displayUrl ?? currentLbUrls?.url ?? null;
  const allSelected = selected.size === totalFound;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (downloadMode) { exitDownloadMode(); return; } router.back(); }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>My Photos</Text>
          {totalFound > 0 && <Text style={styles.headerSub}>{totalFound} photo{totalFound !== 1 ? 's' : ''} found</Text>}
        </View>
        <View style={{ width: 32 }} />
      </View>

      {totalFound === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No photos of you were found in this event.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setCameraReady(false); setMode('camera'); }}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Action row / select bar */}
          {!downloadMode ? (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.downloadPhotosBtn} onPress={() => setDownloadMode(true)}>
                <Text style={styles.downloadPhotosBtnText}>Download Photos</Text>
              </TouchableOpacity>
            </View>
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
              data={listItems}
              keyExtractor={item => item.key}
              estimatedItemSize={THUMB_SIZE + GAP}
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
                      <Text style={styles.sectionHeaderText}>{item.label}</Text>
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

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <GestureHandlerRootView style={styles.lightboxInner}>
          <View style={[styles.lbHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setLightboxVisible(false)}>
              <Text style={styles.lbBack}>←</Text>
            </TouchableOpacity>
            <Text style={styles.lbCounter}>{lightboxIndex + 1} / {totalFound}</Text>
            <View style={styles.lbActions}>
              <TouchableOpacity style={styles.lbBtn} onPress={handleLightboxDownload} disabled={actionLoading}>
                <Text style={styles.lbBtnText}>Download</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.lbBtn} onPress={handleLightboxShare} disabled={actionLoading}>
                <Text style={styles.lbBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={[styles.lbImgWrap, { overflow: 'hidden' }]}>
            <GestureDetector gesture={zoomGesture}>
              <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }, zoomStyle]}>
                {lightboxImageUrl
                  ? <Image source={{ uri: lightboxImageUrl }} style={styles.lbImg} resizeMode="contain" />
                  : <ActivityIndicator color={Colors.accent} />
                }
              </Animated.View>
            </GestureDetector>
            {lightboxIndex > 0 && (
              <TouchableOpacity style={[styles.lbArrow, { left: 0 }]} onPress={() => setLightboxIndex(i => i - 1)}>
                <Text style={styles.lbArrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {lightboxIndex < totalFound - 1 && (
              <TouchableOpacity style={[styles.lbArrow, { right: 0 }]} onPress={() => setLightboxIndex(i => i + 1)}>
                <Text style={styles.lbArrowText}>›</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.lbFooter, { paddingBottom: insets.bottom + 12 }]}>
            {currentLbPhoto?.uploaded_by_name ? (
              <Text style={styles.lbFooterLine1}>Uploaded by {currentLbPhoto.uploaded_by_name}</Text>
            ) : null}
            {currentLbPhoto?.taken_at && (
              <Text style={styles.lbFooterLine2}>
                {'Taken on '}{new Date(currentLbPhoto.taken_at).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                })}
              </Text>
            )}
          </View>
          {alertOverlay}
        </GestureHandlerRootView>
      </Modal>

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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

  // Action row — matches event screen button style
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 },
  downloadPhotosBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  downloadPhotosBtnText: { ...Typography.buttonText, color: Colors.background },

  // Select bar — matches event screen
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: Colors.background, gap: 8 },
  selectCount: { fontSize: 22, fontWeight: '500', color: Colors.white, lineHeight: 24 },
  selectBarBtns: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  selBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selBtnText: { fontSize: 13, color: Colors.textMuted },

  // Section + date headers
  sectionHeader: { backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  sectionHeaderText: { fontSize: 13, fontWeight: '700', color: Colors.white, letterSpacing: 0.5, textTransform: 'uppercase' },
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
  lbBack: { fontSize: 22, color: Colors.textMuted, marginRight: 12 },
  lbCounter: { fontSize: 13, color: '#666', flex: 1 },
  lbActions: { flexDirection: 'row', gap: 8 },
  lbBtn: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 },
  lbBtnText: { fontSize: 13, fontWeight: '500', color: '#888' },
  lbImg: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lbImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' },
  lbArrowText: { fontSize: 36, color: 'rgba(255,255,255,0.35)' },
  lbFooter: { paddingHorizontal: 16, paddingTop: 10 },
  lbFooterLine1: { fontSize: 13, color: '#ccc', marginBottom: 2 },
  lbFooterLine2: { fontSize: 12, color: '#888' },
});
