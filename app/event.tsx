import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, Image, FlatList,
  Modal, Alert, ActivityIndicator, Dimensions, TextInput,
  Platform, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  getEventPhotos, getPhotoUrls, getUploadUrl, processUpload, deletePhotos, downloadZipRaw, downloadPhotoRaw,
} from '../lib/api';
import { getUserProfile } from '../lib/storage';
import { Colors } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GAP = 2;
const THUMB_SIZE = (SCREEN_WIDTH - GAP * 2) / 3;

type Photo = {
  id: string;
  thumbnail_path: string | null;
  media_type: string;
  taken_at: string;
  date_source: string;
  original_filename: string;
  uploaded_by_name: string | null;
  uploaded_by_mobile: string | null;
};

type PhotoUrls = {
  thumbUrl: string | null;
  displayUrl: string | null;
  url: string | null;
  originalFilename: string | null;
};

type ListItem =
  | { type: 'event_header'; key: string }
  | { type: 'expiry_banner'; key: string }
  | { type: 'upload_card'; key: string }
  | { type: 'select_photos_btn'; key: string }
  | { type: 'select_bar'; key: string }
  | { type: 'section_header'; section: 'main' | 'other'; key: string }
  | { type: 'photo_row'; photos: Photo[]; section: 'main' | 'other'; startIndex: number; key: string }
  | { type: 'empty'; key: string };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function buildDownloadFilename(id: string, takenAt: string | null, ext: string): string {
  const date = takenAt ? new Date(takenAt) : new Date();
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}`;
  const timePart = `${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}`;
  const idSuffix = id.replace(/-/g, '').slice(0, 6);
  return `${datePart}_${timePart}_${idSuffix}.${ext}`;
}

function SectionHeader({ section, items, selectMode, selected, onGroupToggle }: {
  section: 'main' | 'other';
  items: Photo[];
  selectMode: boolean;
  selected: Set<string>;
  onGroupToggle: (photos: Photo[], on: boolean) => void;
}) {
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const isMain = section === 'main';
  const label = isMain ? 'Photo Gallery' : 'Other Photos Gallery';
  const allSelected = items.length > 0 && items.every(p => selected.has(p.id));

  useEffect(() => {
    if (!selectMode) { setRangeFrom(''); setRangeTo(''); }
  }, [selectMode]);

  function clampFrom(val: string) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    const to = parseInt(rangeTo, 10);
    const clamped = Math.max(1, Math.min(n, isNaN(to) ? items.length : to));
    setRangeFrom(String(clamped));
  }

  function clampTo(val: string) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    const from = parseInt(rangeFrom, 10);
    const clamped = Math.max(isNaN(from) ? 1 : from, Math.min(n, items.length));
    setRangeTo(String(clamped));
  }

  function applyRange() {
    const from = parseInt(rangeFrom, 10);
    const to = parseInt(rangeTo, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to > items.length || from > to) return;
    onGroupToggle(items.slice(from - 1, to), true);
  }

  function clearRange() {
    onGroupToggle(items, false);
    setRangeFrom('');
    setRangeTo('');
  }

  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <Text style={styles.sectionCount}>{items.length}</Text>
        </View>
        <Text style={styles.sectionSub}>
          {isMain ? '(sorted by date taken · oldest first)' : '(no date info — sorted by upload time)'}
        </Text>
        {selectMode && (
          <View style={styles.sectionSelectRow}>
            <TouchableOpacity onPress={() => onGroupToggle(items, !allSelected)}>
              <Text style={styles.sectionSelectLink}>
                {allSelected ? `Deselect all ${label}` : `Select all ${label}`}
              </Text>
            </TouchableOpacity>
            <View style={styles.rangeRow}>
              <Text style={styles.rangeLabel}>Range:</Text>
              <TextInput
                style={styles.rangeInput}
                keyboardType="number-pad"
                placeholder="From"
                placeholderTextColor="#555"
                value={rangeFrom}
                onChangeText={setRangeFrom}
                onEndEditing={() => clampFrom(rangeFrom)}
              />
              <Text style={styles.rangeLabel}>–</Text>
              <TextInput
                style={styles.rangeInput}
                keyboardType="number-pad"
                placeholder="To"
                placeholderTextColor="#555"
                value={rangeTo}
                onChangeText={setRangeTo}
                onEndEditing={() => clampTo(rangeTo)}
              />
              <Pressable style={styles.rangeBtn} onPress={applyRange}>
                <Text style={styles.rangeBtnText}>Apply</Text>
              </Pressable>
              <Pressable style={styles.rangeBtnOutline} onPress={clearRange}>
                <Text style={styles.rangeBtnOutlineText}>Clear</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function getMimeType(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}

export default function EventScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    slug: string; name: string; expiresAt: string; createdAt: string;
    isAdmin: string; adminPassword: string;
  }>();

  const isAdmin = params.isAdmin === 'true';
  const slug = params.slug;

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [otherPhotos, setOtherPhotos] = useState<Photo[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, PhotoUrls>>({});
  const [loading, setLoading] = useState(true);
  const [userMobile, setUserMobile] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [skippedViewerVisible, setSkippedViewerVisible] = useState(false);
  const [skippedViewerIndex, setSkippedViewerIndex] = useState(0);

  // Lightbox
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxSection, setLightboxSection] = useState<'main' | 'other'>('main');
  const [imageLoading, setImageLoading] = useState(false);
  const imageLoadingRef = useRef(false);

  // Select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stickySection, setStickySection] = useState<'main' | 'other' | null>(null);
  const [selectBarSticky, setSelectBarSticky] = useState(false);
  const mainHeaderY = useRef<number | null>(null);
  const otherHeaderY = useRef<number | null>(null);
  const selectBarYRef = useRef<number | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const accumulatedHeights = useRef<Record<string, number>>({});
  const listDataRef = useRef<ListItem[]>([]);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, duplicates: 0 });
  const uploadCancelledRef = useRef(false);
  const downloadCancelledRef = useRef(false);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const prevSelectedSize = useRef(0);

  const lightboxPhotosRef = useRef<Photo[]>([]);

  // Zoom / pan shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    loadPhotos();
    getUserProfile().then(p => {
      if (p) {
        setUserMobile(p.mobile);
        setUserName(`${p.firstName} ${p.lastName}`.trim());
      }
    });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectMode) {
        exitSelectMode();
        return true;
      }
      router.replace('/(auth)/home');
      return true;
    });
    return () => sub.remove();
  }, [selectMode]);

  useEffect(() => {
    const JPG_LIMIT = 25;
    if (prevSelectedSize.current <= JPG_LIMIT && selected.size > JPG_LIMIT) {
      Alert.alert(
        'Downloading as ZIP',
        `You've selected more than ${JPG_LIMIT} photos. When you tap Download, all selected photos will be bundled into a ZIP file — not downloaded as individual JPGs.\n\nTo download as individual JPGs instead, select ${JPG_LIMIT} or fewer photos.`,
        [{ text: 'Got it' }]
      );
    }
    prevSelectedSize.current = selected.size;
  }, [selected.size]);

  async function loadPhotos() {
    setLoading(true);
    try {
      const data = await getEventPhotos(slug);
      if (data.error) { Alert.alert('Error', data.error); return; }
      const main: Photo[] = data.photos ?? [];
      const other: Photo[] = data.otherPhotos ?? [];
      setPhotos(main);
      setOtherPhotos(other);
      await loadAllUrls([...main, ...other]);
    } catch {
      Alert.alert('Error', 'Could not load photos. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAllUrls(all: Photo[]) {
    const ids = all.map(p => p.id);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await getPhotoUrls(slug, batch);
          if (result.urls) setPhotoUrls(prev => ({ ...prev, ...result.urls }));
        } catch { /* skip */ }
      })
    );
  }

  const lightboxPhotos = lightboxSection === 'main' ? photos : otherPhotos;

  useEffect(() => { lightboxPhotosRef.current = lightboxPhotos; }, [lightboxPhotos]);

  // Mark image as loading whenever we navigate to a new photo
  useEffect(() => {
    if (lightboxVisible) {
      imageLoadingRef.current = true;
      setImageLoading(true);
    }
  }, [lightboxIndex, lightboxVisible]);

  function navigateLightbox(delta: number) {
    setLightboxIndex(prev => {
      const next = prev + delta;
      if (next < 0 || next >= lightboxPhotos.length) return prev;
      return next;
    });
  }

  // Reset zoom whenever photo changes
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [lightboxIndex]);

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

  const panGesture = Gesture.Pan()
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

  const zoomGesture = Gesture.Simultaneous(doubleTapGesture, panGesture, pinchGesture);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectGroup(items: Photo[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(p => on ? next.add(p.id) : next.delete(p.id));
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setStickySection(null);
    setSelectBarSticky(false);
    mainHeaderY.current = null;
    otherHeaderY.current = null;
    selectBarYRef.current = null;
  }

  function updateSectionPositions() {
    let y = 0;
    for (const item of listDataRef.current) {
      if (item.type === 'select_bar') selectBarYRef.current = y;
      if (item.type === 'section_header') {
        if (item.section === 'main') mainHeaderY.current = y;
        else otherHeaderY.current = y;
      }
      y += accumulatedHeights.current[item.key] ?? 0;
    }
  }

  const handleScroll = useCallback((e: any) => {
    if (!selectMode) return;
    const y = e.nativeEvent.contentOffset.y;

    const newSelectBarSticky = selectBarYRef.current !== null && y >= selectBarYRef.current;
    setSelectBarSticky(prev => prev === newSelectBarSticky ? prev : newSelectBarSticky);

    let next: 'main' | 'other' | null = null;
    if (otherHeaderY.current !== null && y >= otherHeaderY.current) next = 'other';
    else if (mainHeaderY.current !== null && y >= mainHeaderY.current) next = 'main';
    setStickySection(prev => prev === next ? prev : next);
  }, [selectMode]);

  async function handleUpload(source: 'camera' | 'gallery') {
    const permResult = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }

    const pickResult = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          selectionLimit: 40,
          quality: 1,
        });

    if (pickResult.canceled || !pickResult.assets?.length) return;

    const assets = pickResult.assets;
    uploadCancelledRef.current = false;
    setUploading(true);
    setUploadProgress({ current: 0, total: assets.length, duplicates: 0 });

    let duplicates = 0;
    let failed = 0;

    for (let i = 0; i < assets.length; i++) {
      if (uploadCancelledRef.current) break;
      const asset = assets[i];
      const filename = asset.fileName ?? `photo_${Date.now()}.jpg`;
      const contentType = getMimeType(asset.uri);

      try {
        const urlResult = await getUploadUrl(slug, filename, contentType);
        if (urlResult.error) { failed++; continue; }
        const { uploadUrl, stagingKey } = urlResult;
        const blob = await (await fetch(asset.uri)).blob();
        const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
        if (!putRes.ok) { failed++; continue; }
        const proc = await processUpload(slug, stagingKey, filename, userMobile ?? undefined, userName ?? undefined);
        if (proc.duplicate) duplicates++;
        else if (proc.error) failed++;
      } catch { failed++; }

      setUploadProgress({ current: i + 1, total: assets.length, duplicates });
    }

    setUploading(false);
    const uploaded = assets.length - duplicates - failed;
    const parts = [];
    if (uploaded > 0) parts.push(`${uploaded} uploaded`);
    if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (parts.length) Alert.alert('Upload complete', parts.join(' · '));
    await loadPhotos();
  }

  function showUploadOptions() {
    if (Platform.OS === 'ios') {
      const { ActionSheetIOS } = require('react-native');
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take a photo', 'Choose from library'], cancelButtonIndex: 0 },
        (i: number) => { if (i === 1) handleUpload('camera'); if (i === 2) handleUpload('gallery'); }
      );
    } else {
      Alert.alert('Upload photos', 'Choose a source', [
        { text: 'Take a photo', onPress: () => handleUpload('camera') },
        { text: 'Choose from library', onPress: () => handleUpload('gallery') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function handleDeletePhoto(id: string) {
    Alert.alert('Delete photo', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const result = isAdmin
            ? await deletePhotos(slug, [id], params.adminPassword)
            : await deletePhotos(slug, [id], '', userMobile ?? undefined);
          if (result.error) { Alert.alert('Error', result.error); return; }
          setLightboxVisible(false);
          await loadPhotos();
        },
      },
    ]);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    Alert.alert('Delete photos', `Delete ${ids.length} photo${ids.length > 1 ? 's' : ''}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const result = await deletePhotos(slug, ids, params.adminPassword);
          if (result.error) { Alert.alert('Error', result.error); return; }
          exitSelectMode();
          await loadPhotos();
        },
      },
    ]);
  }

  const JPG_LIMIT = 25;

  async function saveToDownloads(filename: string, cacheUri: string, mimeType: string) {
    if (Platform.OS === 'android') {
      const destPath = `/storage/emulated/0/Download/${filename}`;
      await FileSystem.copyAsync({ from: cacheUri, to: destPath });
    } else {
      await Sharing.shareAsync(cacheUri, { mimeType, dialogTitle: 'Save file' });
    }
  }

  async function handleDownloadPhoto(id: string) {
    const photo = [...photos, ...otherPhotos].find(p => p.id === id);
    Alert.alert('Download photo', 'Save this photo to your Downloads folder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Download', onPress: async () => {
          try {
            const rawName = photo?.original_filename ?? `photo_${id}.jpg`;
            const ext = rawName.split('.').pop()?.toLowerCase() ?? 'jpg';
            const filename = buildDownloadFilename(id, photo?.taken_at ?? null, ext);
            const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
            const res = await downloadPhotoRaw(id, isAdmin ? params.adminPassword : undefined);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = await res.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            let binary = '';
            for (let j = 0; j < uint8.length; j++) binary += String.fromCharCode(uint8[j]);
            await FileSystem.writeAsStringAsync(cacheUri, btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
            await saveToDownloads(filename, cacheUri, 'image/jpeg');
            Alert.alert('Done', 'Photo saved to Downloads.');
          } catch {
            Alert.alert('Error', 'Could not download photo.');
          }
        },
      },
    ]);
  }

  async function saveAsJpgs(ids: string[], urlMap: Record<string, { url: string | null; originalFilename: string | null }>) {
    downloadCancelledRef.current = false;
    setDownloadingBulk(true);
    setDownloadProgress({ current: 0, total: ids.length });
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      if (downloadCancelledRef.current) break;
      const id = ids[i];
      const u = urlMap[id];
      if (!u?.url) { failed++; setDownloadProgress({ current: i + 1, total: ids.length }); continue; }
      try {
        const rawName = u.originalFilename ?? `photo_${id}.jpg`;
        const ext = rawName.split('.').pop()?.toLowerCase() ?? 'jpg';
        const filename = buildDownloadFilename(id, u.takenAt ?? null, ext);
        const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
        const dlResult = await FileSystem.downloadAsync(u.url, cacheUri);
        if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
        await saveToDownloads(filename, cacheUri, 'image/jpeg');
        saved++;
        await new Promise(r => setTimeout(r, 200));
      } catch { failed++; }
      setDownloadProgress({ current: i + 1, total: ids.length });
    }
    setDownloadingBulk(false);
    exitSelectMode();
    const parts: string[] = [];
    if (saved > 0) parts.push(`${saved} saved to Downloads`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (parts.length) Alert.alert('Download complete', parts.join(' · '));
  }

  async function downloadAsZip(ids: string[]) {
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
    downloadCancelledRef.current = false;
    setDownloadingBulk(true);
    setDownloadProgress({ current: 0, total: totalBatches });
    let savedBatches = 0;
    const allSkippedIds: string[] = [];
    try {
      for (let i = 0; i < totalBatches; i++) {
        if (downloadCancelledRef.current) break;
        const batchIds = ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const filename = totalBatches > 1
          ? `${slug}-photos-part${i + 1}of${totalBatches}.zip`
          : `${slug}-photos.zip`;
        const res = await downloadZipRaw(slug, batchIds);
        if (!res.ok) {
          const text = await res.text().catch(() => 'no body');
          throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
        }
        const buffer = await res.arrayBuffer();

        // Parse trailer: [zip bytes][JSON utf8][4-byte LE uint32 = JSON length]
        const view = new DataView(buffer);
        const trailerLen = view.getUint32(buffer.byteLength - 4, true);
        const jsonBytes = buffer.slice(buffer.byteLength - 4 - trailerLen, buffer.byteLength - 4);
        try {
          const trailer = JSON.parse(new TextDecoder().decode(jsonBytes)) as { skippedIds?: string[] };
          if (trailer.skippedIds?.length) allSkippedIds.push(...trailer.skippedIds);
        } catch { /* no trailer — older backend */ }
        const zipBuffer = buffer.slice(0, buffer.byteLength - 4 - trailerLen);

        const uint8 = new Uint8Array(zipBuffer);
        let binary = '';
        for (let j = 0; j < uint8.length; j++) binary += String.fromCharCode(uint8[j]);
        const base64 = btoa(binary);
        const cacheZipPath = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(cacheZipPath, base64, { encoding: FileSystem.EncodingType.Base64 });
        await saveToDownloads(filename, cacheZipPath, 'application/zip');
        savedBatches++;
        setDownloadProgress({ current: savedBatches, total: totalBatches });
      }
      setDownloadingBulk(false);
      exitSelectMode();
      const msg = totalBatches > 1
        ? `${savedBatches} of ${totalBatches} ZIP files saved to Downloads.`
        : 'ZIP saved to Downloads.';
      Alert.alert('Download complete', msg);
      if (allSkippedIds.length > 0) {
        setSkippedIds(allSkippedIds);
        setSkippedViewerIndex(0);
        setSkippedViewerVisible(true);
      }
    } catch (e: any) {
      setDownloadingBulk(false);
      Alert.alert('Error', `ZIP failed: ${e?.message ?? 'unknown error'}`);
    }
  }

  async function resolveUrlsForIds(ids: string[]): Promise<Record<string, { url: string | null; originalFilename: string | null; takenAt: string | null }>> {
    const result: Record<string, { url: string | null; originalFilename: string | null; takenAt: string | null }> = {};
    const allPhotos = [...photos, ...otherPhotos];
    // Always fetch fresh signed URLs — cached ones may have expired
    try {
      const fetched = await getPhotoUrls(slug, ids);
      if (fetched.urls) {
        setPhotoUrls(prev => ({ ...prev, ...fetched.urls }));
        for (const id of ids) {
          const p = fetched.urls[id];
          const photo = allPhotos.find(ph => ph.id === id);
          result[id] = { url: p?.url ?? p?.displayUrl ?? null, originalFilename: p?.originalFilename ?? null, takenAt: photo?.taken_at ?? null };
        }
        return result;
      }
    } catch { /* fall through to cached */ }
    // Fallback: use cached state
    for (const id of ids) {
      const p = photoUrls[id];
      const photo = allPhotos.find(ph => ph.id === id);
      result[id] = { url: p?.url ?? p?.displayUrl ?? null, originalFilename: p?.originalFilename ?? null, takenAt: photo?.taken_at ?? null };
    }
    return result;
  }

  async function handleBulkDownload() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    if (ids.length > JPG_LIMIT) {
      Alert.alert(
        `Download ${ids.length} photos as ZIP`,
        `${Math.ceil(ids.length / 50)} ZIP file${Math.ceil(ids.length / 50) > 1 ? 's' : ''} will be saved to your Downloads folder.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Download', onPress: () => downloadAsZip(ids) },
        ]
      );
      return;
    }

    Alert.alert(
      `Download ${ids.length} photo${ids.length > 1 ? 's' : ''}`,
      'How would you like to download?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save as JPG',
          onPress: async () => {
            const urlMap = await resolveUrlsForIds(ids);
            await saveAsJpgs(ids, urlMap);
          },
        },
        { text: 'Save as ZIP', onPress: () => downloadAsZip(ids) },
      ]
    );
  }

  const daysLeft = params.expiresAt ? daysUntil(params.expiresAt) : 999;
  const totalPhotos = photos.length + otherPhotos.length;
  const allSelected = totalPhotos > 0 && [...photos, ...otherPhotos].every(p => selected.has(p.id));

  // Build flat list data + compute sticky indices
  const { listData, stickyIndices } = useMemo(() => {
    const items: ListItem[] = [];
    const sticky: number[] = [];

    items.push({ type: 'event_header', key: 'event_header' });
    if (daysLeft <= 3) items.push({ type: 'expiry_banner', key: 'expiry_banner' });
    items.push({ type: 'upload_card', key: 'upload_card' });

    if (totalPhotos > 0 && !selectMode) {
      items.push({ type: 'select_photos_btn', key: 'select_photos_btn' });
    }

    if (selectMode) {
      items.push({ type: 'select_bar', key: 'select_bar' });
    }

    if (photos.length > 0) {
      items.push({ type: 'section_header', section: 'main', key: 'header_main' });
      for (let i = 0; i < photos.length; i += 3) {
        items.push({ type: 'photo_row', photos: photos.slice(i, i + 3), section: 'main', startIndex: i, key: `row_main_${i}` });
      }
    }

    if (otherPhotos.length > 0) {
      items.push({ type: 'section_header', section: 'other', key: 'header_other' });
      for (let i = 0; i < otherPhotos.length; i += 3) {
        items.push({ type: 'photo_row', photos: otherPhotos.slice(i, i + 3), section: 'other', startIndex: i, key: `row_other_${i}` });
      }
    }

    if (totalPhotos === 0 && !loading) {
      items.push({ type: 'empty', key: 'empty' });
    }

    return { listData: items, stickyIndices: sticky };
  }, [photos, otherPhotos, selectMode, daysLeft, totalPhotos, loading]);

  useEffect(() => {
    listDataRef.current = listData;
    updateSectionPositions();
  }, [listData]);

  function renderSelectBar() {
    return (
      <View style={styles.selectBar}>
        <View>
          <Text style={styles.selectCount}>{selected.size}</Text>
          <Text style={styles.selectCountLabel}>selected</Text>
        </View>
        <View style={styles.selectBarBtns}>
          <Pressable style={styles.selBtn} onPress={() => selectGroup([...photos, ...otherPhotos], !allSelected)}>
            <Text style={styles.selBtnText}>Select all</Text>
          </Pressable>
          <Pressable style={styles.selBtn} onPress={exitSelectMode}>
            <Text style={styles.selBtnText}>Cancel</Text>
          </Pressable>
          {isAdmin && (
            <Pressable style={[styles.selBtn, { opacity: selected.size === 0 ? 0.4 : 1 }]} disabled={selected.size === 0} onPress={handleBulkDelete}>
              <Text style={[styles.selBtnText, { color: Colors.danger }]}>Delete</Text>
            </Pressable>
          )}
          <Pressable style={[styles.selBtnPrimary, { opacity: selected.size === 0 ? 0.4 : 1 }]} disabled={selected.size === 0} onPress={handleBulkDownload}>
            <Text style={styles.selBtnPrimaryText}>↓ Download</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderThumb(photo: Photo, index: number, section: 'main' | 'other') {
    const urls = photoUrls[photo.id];
    const isSelected = selected.has(photo.id);
    return (
      <TouchableOpacity
        key={photo.id}
        style={styles.thumb}
        onPress={() => {
          if (selectMode) {
            toggleSelect(photo.id);
          } else {
            setLightboxIndex(index);
            setLightboxSection(section);
            setLightboxVisible(true);
          }
        }}
        activeOpacity={0.85}
      >
        {urls?.thumbUrl
          ? <Image source={{ uri: urls.thumbUrl }} style={styles.thumbImage} />
          : <View style={styles.thumbSkeleton} />
        }
        {selectMode && (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  }

  function renderItem({ item }: { item: ListItem }) {
    return (
      <View onLayout={(e) => {
        accumulatedHeights.current[item.key] = e.nativeEvent.layout.height;
        updateSectionPositions();
      }}>
        {renderItemContent(item)}
      </View>
    );
  }

  function renderItemContent(item: ListItem) {
    switch (item.type) {
      case 'event_header': {
        const total = totalPhotos;
        return (
          <View style={styles.eventHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(auth)/home')}>
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>
            <View style={styles.eventHeaderBody}>
              <Text style={styles.eventName}>{params.name || 'Event'}</Text>
              {params.expiresAt && (
                <Text style={styles.eventMeta}>
                  Event expires {formatDate(params.expiresAt)}
                  {total > 0 ? ` · ${total} photo${total !== 1 ? 's' : ''}` : ''}
                </Text>
              )}
              {photos.length > 0 && otherPhotos.length > 0 && (
                <Text style={styles.eventMetaSub}>
                  {photos.length} in Photo Gallery · {otherPhotos.length} in Other Photos Gallery
                </Text>
              )}
            </View>
          </View>
        );
      }

      case 'expiry_banner':
        return (
          <View style={styles.expiryBanner}>
            <Text style={styles.expiryText}>
              {daysLeft < 0
                ? 'This event has closed. Download your photos before they are removed.'
                : daysLeft === 0 ? 'This event closes today. Download your photos before then.'
                : daysLeft === 1 ? 'This event closes tomorrow. Download your photos before then.'
                : `This event closes in ${daysLeft} days. Download your photos before then.`}
            </Text>
          </View>
        );

      case 'upload_card':
        return (
          <View style={styles.uploadCard}>
            <TouchableOpacity style={[styles.uploadBtn, uploading && { opacity: 0.5 }]} onPress={showUploadOptions} disabled={uploading}>
              <Text style={styles.uploadBtnText}>Upload Photos</Text>
            </TouchableOpacity>
            <Text style={styles.uploadHint}>Don't close the app while uploading.</Text>
          </View>
        );

      case 'select_photos_btn':
        return (
          <View style={styles.selectPhotosRow}>
            <TouchableOpacity style={styles.selectPhotosBtn} onPress={() => setSelectMode(true)}>
              <Text style={styles.selectPhotosBtnText}>Select photos</Text>
            </TouchableOpacity>
          </View>
        );

      case 'select_bar':
        return (
          <View style={{ opacity: selectBarSticky ? 0 : 1 }}>
            {renderSelectBar()}
          </View>
        );

      case 'section_header':
        return (
          <View style={{ opacity: stickySection === item.section ? 0 : 1 }}>
            <SectionHeader
              section={item.section}
              items={item.section === 'main' ? photos : otherPhotos}
              selectMode={selectMode}
              selected={selected}
              onGroupToggle={selectGroup}
            />
          </View>
        );

      case 'photo_row':
        return (
          <View style={styles.photoRow}>
            {item.photos.map((p, ci) => renderThumb(p, item.startIndex + ci, item.section))}
            {item.photos.length < 3 && Array(3 - item.photos.length).fill(null).map((_, k) => (
              <View key={`e${k}`} style={{ width: THUMB_SIZE }} />
            ))}
          </View>
        );

      case 'empty':
        return (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No photos yet.</Text>
            <Text style={styles.emptySub}>Be the first to upload!</Text>
          </View>
        );

      default:
        return null;
    }
  }

  const currentPhoto = lightboxPhotos[lightboxIndex];
  const currentUrls = currentPhoto ? photoUrls[currentPhoto.id] : null;
  const lightboxImageUrl = currentUrls?.displayUrl ?? currentUrls?.url ?? null;

  const skippedPhotoList = useMemo(() => {
    const allPhotos = [...photos, ...otherPhotos];
    return skippedIds.map(id => allPhotos.find(p => p.id === id)).filter(Boolean) as Photo[];
  }, [skippedIds, photos, otherPhotos]);
  const currentSkipped = skippedPhotoList[skippedViewerIndex];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: 100 }} color={Colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Upload progress overlay */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadOverlayCard}>
            <View style={styles.uploadOverlayHeader}>
              <Text style={styles.uploadOverlayTitle}>Uploading photos</Text>
              <TouchableOpacity onPress={() => { uploadCancelledRef.current = true; }}>
                <Text style={styles.uploadOverlayCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.uploadOverlaySub}>
              {uploadProgress.current} of {uploadProgress.total} uploaded
              {uploadProgress.duplicates > 0 ? ` · ${uploadProgress.duplicates} duplicate${uploadProgress.duplicates > 1 ? 's' : ''} skipped` : ''}
            </Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, {
                width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}%` as any,
              }]} />
            </View>
            <Text style={styles.uploadOverlayPct}>
              {uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}% complete — keep this screen open
            </Text>
          </View>
        </View>
      )}

      {/* Download progress overlay */}
      {downloadingBulk && (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadOverlayCard}>
            <View style={styles.uploadOverlayHeader}>
              <Text style={styles.uploadOverlayTitle}>Downloading</Text>
              <TouchableOpacity onPress={() => { downloadCancelledRef.current = true; }}>
                <Text style={styles.uploadOverlayCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.uploadOverlaySub}>
              Downloading photo {downloadProgress.current} of {downloadProgress.total}…
            </Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, {
                width: `${downloadProgress.total > 0 ? Math.round((downloadProgress.current / downloadProgress.total) * 100) : 0}%` as any,
              }]} />
            </View>
            <Text style={styles.uploadOverlayPct}>
              {downloadProgress.total > 0 ? Math.round((downloadProgress.current / downloadProgress.total) * 100) : 0}% complete — keep this screen open
            </Text>
          </View>
        </View>
      )}

      {/* Skipped Photos Viewer */}
      <Modal visible={skippedViewerVisible} animationType="slide" onRequestClose={() => setSkippedViewerVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.skippedHeader}>
            <Text style={styles.skippedTitle}>
              Missing from download — {skippedViewerIndex + 1} of {skippedPhotoList.length}
            </Text>
            <TouchableOpacity onPress={() => setSkippedViewerVisible(false)}>
              <Text style={styles.skippedClose}>×</Text>
            </TouchableOpacity>
          </View>
          {currentSkipped && (
            <View style={styles.skippedBody}>
              {photoUrls[currentSkipped.id]?.thumbUrl
                ? <Image source={{ uri: photoUrls[currentSkipped.id].thumbUrl! }} style={styles.skippedThumb} resizeMode="contain" />
                : <View style={styles.skippedThumbPlaceholder} />
              }
              <Text style={styles.skippedFilename}>{currentSkipped.original_filename}</Text>
            </View>
          )}
          <View style={styles.skippedNav}>
            <TouchableOpacity
              style={[styles.skippedNavBtn, skippedViewerIndex === 0 && { opacity: 0.3 }]}
              onPress={() => setSkippedViewerIndex(i => Math.max(0, i - 1))}
              disabled={skippedViewerIndex === 0}
            >
              <Text style={styles.skippedNavBtnText}>‹ Previous</Text>
            </TouchableOpacity>
            {skippedViewerIndex < skippedPhotoList.length - 1 ? (
              <TouchableOpacity style={styles.skippedNavBtn} onPress={() => setSkippedViewerIndex(i => i + 1)}>
                <Text style={styles.skippedNavBtnText}>Next ›</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.skippedNavBtn} onPress={() => setSkippedViewerIndex(i => i + 1)}>
                <Text style={[styles.skippedNavBtnText, { opacity: 0.3 }]}>Next ›</Text>
              </TouchableOpacity>
            )}
          </View>
          {skippedViewerIndex === skippedPhotoList.length - 1 && (
            <View style={styles.skippedActions}>
              <TouchableOpacity style={styles.skippedActionBtn} onPress={() => {
                setSkippedViewerVisible(false);
                const ids = skippedPhotoList.map(p => p.id);
                resolveUrlsForIds(ids).then(urlMap => saveAsJpgs(ids, urlMap));
              }}>
                <Text style={styles.skippedActionText}>Download as JPGs</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skippedActionBtn} onPress={() => {
                setSkippedViewerVisible(false);
                downloadAsZip(skippedPhotoList.map(p => p.id));
              }}>
                <Text style={styles.skippedActionText}>Download as ZIP</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.skippedActionBtn, { borderColor: 'transparent' }]} onPress={() => setSkippedViewerVisible(false)}>
                <Text style={[styles.skippedActionText, { color: Colors.textMuted }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={styles.lightbox}>
          <SafeAreaView style={styles.lightboxInner}>
            <View style={styles.lbHeader}>
              <TouchableOpacity onPress={() => setLightboxVisible(false)}>
                <Text style={styles.lbBack}>←</Text>
              </TouchableOpacity>
              <Text style={styles.lbCounter}>{lightboxIndex + 1} / {lightboxPhotos.length}</Text>
              <View style={styles.lbActions}>
                <TouchableOpacity style={styles.lbBtn} onPress={() => currentPhoto && handleDownloadPhoto(currentPhoto.id)}>
                  <Text style={styles.lbBtnText}>Download</Text>
                </TouchableOpacity>
                {(isAdmin || (currentPhoto?.uploaded_by_mobile && currentPhoto.uploaded_by_mobile === userMobile)) && (
                  <TouchableOpacity style={[styles.lbBtn, styles.lbBtnDanger]} onPress={() => currentPhoto && handleDeletePhoto(currentPhoto.id)}>
                    <Text style={[styles.lbBtnText, { color: Colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
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
              {lightboxIndex > 0 && !imageLoading && (
                <TouchableOpacity style={[styles.lbArrow, { left: 0 }]} onPress={() => navigateLightbox(-1)}>
                  <Text style={styles.lbArrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {lightboxIndex < lightboxPhotos.length - 1 && !imageLoading && (
                <TouchableOpacity style={[styles.lbArrow, { right: 0 }]} onPress={() => navigateLightbox(1)}>
                  <Text style={styles.lbArrowText}>›</Text>
                </TouchableOpacity>
              )}
            </View>
            {currentPhoto?.taken_at && (
              <Text style={styles.lbMeta}>
                {new Date(currentPhoto.taken_at).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                })}
              </Text>
            )}
            {currentPhoto?.uploaded_by_name && (
              <Text style={styles.lbUploadedBy}>Uploaded by {currentPhoto.uploaded_by_name}</Text>
            )}
            <Text style={styles.lbSwipeHint}>Swipe left / right to navigate</Text>
          </SafeAreaView>
        </View>
      </Modal>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          key={selectMode ? 'select' : 'normal'}
          data={listData}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          extraData={[selected, stickySection, selectBarSticky]}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 48 }}
          removeClippedSubviews={false}
        />
        {selectMode && selectBarSticky && (
          <View style={styles.stickySelectBar}>
            {renderSelectBar()}
          </View>
        )}
        {selectMode && stickySection && (
          <View style={[styles.stickySectionHeader, {
            top: selectBarSticky ? (accumulatedHeights.current['select_bar'] ?? 0) : 0,
          }]}>
            <SectionHeader
              section={stickySection}
              items={stickySection === 'main' ? photos : otherPhotos}
              selectMode={selectMode}
              selected={selected}
              onGroupToggle={selectGroup}
            />
          </View>
        )}
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Event header
  eventHeader: { paddingTop: 12, paddingBottom: 16, paddingHorizontal: 16 },
  backBtn: { marginBottom: 8 },
  backText: { fontSize: 24, color: Colors.textMuted },
  eventHeaderBody: { alignItems: 'center' },
  eventName: { fontSize: 22, fontWeight: '600', color: Colors.white, textAlign: 'center', marginBottom: 4 },
  eventMeta: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 2 },
  eventMetaSub: { fontSize: 12, color: '#666', textAlign: 'center' },

  // Expiry banner
  expiryBanner: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', backgroundColor: 'rgba(245,158,11,0.08)', paddingHorizontal: 14, paddingVertical: 10 },
  expiryText: { fontSize: 13, color: '#D97706', lineHeight: 20 },

  // Upload card
  uploadCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.cardBorder, backgroundColor: Colors.card, padding: 16, alignItems: 'center' },
  uploadBtn: { backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, marginBottom: 10 },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: Colors.white },
  uploadHint: { fontSize: 12, color: '#666', textAlign: 'center' },

  // Select photos button
  selectPhotosRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 8 },
  selectPhotosBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  selectPhotosBtnText: { fontSize: 14, fontWeight: '500', color: Colors.textMuted },

  // Select mode bar (sticky)
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: Colors.card, borderBottomWidth: 0.5, borderBottomColor: Colors.cardBorder, gap: 8 },
  selectCount: { fontSize: 22, fontWeight: '500', color: Colors.white, lineHeight: 24 },
  selectCountLabel: { fontSize: 11, color: '#666' },
  selectBarBtns: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  selBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  selBtnText: { fontSize: 13, color: Colors.textMuted },
  selBtnPrimary: { backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  selBtnPrimaryText: { fontSize: 13, fontWeight: '600', color: Colors.white },

  stickySelectBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  stickySectionHeader: { position: 'absolute', left: 0, right: 0, zIndex: 10 },

  // Section header
  sectionBlock: { backgroundColor: Colors.background },
  sectionHeader: { backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  sectionCount: { fontSize: 14, color: '#888' },
  sectionSub: { fontSize: 13, color: '#666' },
  sectionSelectLink: { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },
  sectionSelectRow: { marginTop: 6, gap: 6 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rangeLabel: { fontSize: 12, color: '#666' },
  rangeInput: { width: 52, borderWidth: 1, borderColor: '#333', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, color: Colors.white, backgroundColor: '#1a1a1a', textAlign: 'center' },
  rangeBtn: { backgroundColor: Colors.white, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  rangeBtnText: { fontSize: 12, fontWeight: '600', color: Colors.background },
  rangeBtnOutline: { borderWidth: 1, borderColor: '#444', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  rangeBtnOutlineText: { fontSize: 12, color: '#aaa' },

  // Photo grid
  photoRow: { flexDirection: 'row', gap: GAP, marginTop: GAP },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, backgroundColor: '#1a1a1a' },
  thumbImage: { width: '100%', height: '100%' },
  thumbSkeleton: { flex: 1, backgroundColor: '#252525' },
  checkbox: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: Colors.background, borderColor: Colors.white },
  checkboxTick: { fontSize: 11, fontWeight: '800', color: Colors.white },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '500', color: Colors.textMuted, marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#444' },

  // Upload overlay
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  uploadOverlayCard: { width: '100%', backgroundColor: Colors.card, borderRadius: 16, padding: 20 },
  uploadOverlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  uploadOverlayTitle: { fontSize: 16, fontWeight: '600', color: Colors.white },
  uploadOverlayCancel: { fontSize: 13, color: Colors.danger },
  uploadOverlaySub: { fontSize: 13, color: Colors.textMuted, marginBottom: 10 },
  progressBg: { height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: Colors.white, borderRadius: 4 },
  uploadOverlayPct: { fontSize: 11, color: '#666' },

  // Lightbox
  lightbox: { flex: 1, backgroundColor: '#000' },
  lightboxInner: { flex: 1 },
  lbHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
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
  // Skipped Photos Viewer
  skippedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  skippedTitle: { fontSize: 14, fontWeight: '600', color: Colors.white, flex: 1 },
  skippedClose: { fontSize: 26, color: Colors.textMuted, paddingLeft: 16 },
  skippedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  skippedThumb: { width: SCREEN_WIDTH - 48, height: SCREEN_WIDTH - 48, borderRadius: 12, marginBottom: 16 },
  skippedThumbPlaceholder: { width: SCREEN_WIDTH - 48, height: SCREEN_WIDTH - 48, borderRadius: 12, backgroundColor: '#1a1a1a', marginBottom: 16 },
  skippedFilename: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  skippedNav: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  skippedNavBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  skippedNavBtnText: { fontSize: 15, color: Colors.accent, fontWeight: '600' },
  skippedActions: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
  skippedActionBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 12, padding: 14, alignItems: 'center' },
  skippedActionText: { fontSize: 14, fontWeight: '600', color: Colors.white },

  lbMeta: { fontSize: 12, color: '#555', textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  lbUploadedBy: { fontSize: 12, color: '#444', textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  lbSwipeHint: { fontSize: 10, color: '#333', textAlign: 'center', paddingBottom: 10 },
});
