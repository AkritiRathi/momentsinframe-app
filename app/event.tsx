import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, Image, FlatList,
  Modal, Alert, ActivityIndicator, Dimensions, PanResponder,
  Platform, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  getEventPhotos, getPhotoUrls, getUploadUrl, processUpload, deletePhotos, downloadZipRaw,
} from '../lib/api';
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

  // Lightbox
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxSection, setLightboxSection] = useState<'main' | 'other'>('main');

  // Select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, duplicates: 0 });
  const uploadCancelledRef = useRef(false);
  const downloadCancelledRef = useRef(false);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const prevSelectedSize = useRef(0);
  const [pinnedBarVisible, setPinnedBarVisible] = useState(false);
  const prevSelectMode = useRef(false);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 90, minimumViewTime: 0 }).current;
  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    const naturalBarVisible = viewableItems.some((v: any) => v.item?.key === 'select_bar');
    setPinnedBarVisible(!naturalBarVisible);
  }, []);

  useEffect(() => {
    if (prevSelectMode.current && !selectMode) {
      setPinnedBarVisible(false);
    }
    if (!prevSelectMode.current && selectMode) {
      setPinnedBarVisible(false);
    }
    prevSelectMode.current = selectMode;
  }, [selectMode]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
      onPanResponderRelease: (_, { dx }) => {
        if (dx < -50) navigateLightbox(1);
        else if (dx > 50) navigateLightbox(-1);
      },
    })
  ).current;

  useEffect(() => { loadPhotos(); }, []);

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

  function navigateLightbox(delta: number) {
    setLightboxIndex(prev => {
      const next = prev + delta;
      if (next < 0 || next >= lightboxPhotos.length) return prev;
      return next;
    });
  }

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
    setPinnedBarVisible(false);
  }

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
        const proc = await processUpload(slug, stagingKey, filename);
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
          const result = await deletePhotos(slug, [id], params.adminPassword);
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
    const urls = photoUrls[id];
    const best = urls?.url ?? urls?.displayUrl ?? null;
    if (!best) { Alert.alert('Not available', 'Photo URL not loaded yet.'); return; }
    Alert.alert('Download photo', 'Save this photo to your Downloads folder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Download', onPress: async () => {
          try {
            const rawName = urls?.originalFilename ?? `photo_${id}.jpg`;
            const ext = rawName.match(/(\.[^.]+)$/) ? rawName.match(/(\.[^.]+)$/)![1] : '.jpg';
            const base = rawName.replace(/(\.[^.]+)$/, '').replace(/[^a-zA-Z0-9-]/g, '_');
            const filename = `MIF_${base}_${Date.now()}${ext}`;
            const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
            await FileSystem.downloadAsync(best, cacheUri);
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
        const ext = rawName.match(/(\.[^.]+)$/) ? rawName.match(/(\.[^.]+)$/)![1] : '.jpg';
        const base = rawName.replace(/(\.[^.]+)$/, '').replace(/[^a-zA-Z0-9-]/g, '_');
        const filename = `MIF_${i + 1}_${base}${ext}`;
        const cacheUri = `${FileSystem.cacheDirectory}dl_${i}_${filename}`;
        const dlResult = await FileSystem.downloadAsync(u.url, cacheUri);
        if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
        await saveToDownloads(filename, cacheUri, 'image/jpeg');
        saved++;
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
        const uint8 = new Uint8Array(buffer);
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
    } catch (e: any) {
      setDownloadingBulk(false);
      Alert.alert('Error', `ZIP failed: ${e?.message ?? 'unknown error'}`);
    }
  }

  async function resolveUrlsForIds(ids: string[]): Promise<Record<string, { url: string | null; originalFilename: string | null }>> {
    const result: Record<string, { url: string | null; originalFilename: string | null }> = {};
    // Always fetch fresh signed URLs — cached ones may have expired
    try {
      const fetched = await getPhotoUrls(slug, ids);
      if (fetched.urls) {
        setPhotoUrls(prev => ({ ...prev, ...fetched.urls }));
        for (const id of ids) {
          const p = fetched.urls[id];
          result[id] = { url: p?.url ?? p?.displayUrl ?? null, originalFilename: p?.originalFilename ?? null };
        }
        return result;
      }
    } catch { /* fall through to cached */ }
    // Fallback: use cached state
    for (const id of ids) {
      const p = photoUrls[id];
      result[id] = { url: p?.url ?? p?.displayUrl ?? null, originalFilename: p?.originalFilename ?? null };
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

    if (totalPhotos > 0) {
      if (!selectMode) {
        items.push({ type: 'select_photos_btn', key: 'select_photos_btn' });
      } else {
        items.push({ type: 'select_bar', key: 'select_bar' });
      }
    }

    if (photos.length > 0) {
      sticky.push(items.length);
      items.push({ type: 'section_header', section: 'main', key: 'header_main' });
      for (let i = 0; i < photos.length; i += 3) {
        items.push({ type: 'photo_row', photos: photos.slice(i, i + 3), section: 'main', startIndex: i, key: `row_main_${i}` });
      }
    }

    if (otherPhotos.length > 0) {
      sticky.push(items.length);
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
        return renderSelectBar();

      case 'section_header': {
        const isMain = item.section === 'main';
        const sectionItems = isMain ? photos : otherPhotos;
        const allInSection = sectionItems.every(p => selected.has(p.id));
        return (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>{isMain ? 'Photo Gallery' : 'Other Photos Gallery'}</Text>
                <Text style={styles.sectionCount}>{sectionItems.length}</Text>
              </View>
              <Text style={styles.sectionSub}>
                {isMain ? '(sorted by date taken · oldest first)' : '(no date info — sorted by upload time)'}
              </Text>
              {selectMode && (
                <TouchableOpacity onPress={() => selectGroup(sectionItems, !allInSection)} style={{ marginTop: 4 }}>
                  <Text style={styles.sectionSelectLink}>
                    {allInSection
                      ? `Deselect all ${isMain ? 'Photo Gallery' : 'Other Photos Gallery'}`
                      : `Select all ${isMain ? 'Photo Gallery' : 'Other Photos Gallery'}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      }

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
              {downloadProgress.current} of {downloadProgress.total} downloaded
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

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={styles.lightbox} {...panResponder.panHandlers}>
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
                {isAdmin && (
                  <TouchableOpacity style={[styles.lbBtn, styles.lbBtnDanger]} onPress={() => currentPhoto && handleDeletePhoto(currentPhoto.id)}>
                    <Text style={[styles.lbBtnText, { color: Colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.lbImgWrap}>
              {lightboxImageUrl
                ? <Image source={{ uri: lightboxImageUrl }} style={styles.lbImg} resizeMode="contain" />
                : <ActivityIndicator color={Colors.accent} />
              }
              {lightboxIndex > 0 && (
                <TouchableOpacity style={[styles.lbArrow, { left: 0 }]} onPress={() => navigateLightbox(-1)}>
                  <Text style={styles.lbArrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {lightboxIndex < lightboxPhotos.length - 1 && (
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
            <Text style={styles.lbSwipeHint}>Swipe left / right to navigate</Text>
          </SafeAreaView>
        </View>
      </Modal>

      {selectMode && pinnedBarVisible && renderSelectBar()}

      <FlatList
        key={selectMode ? 'select' : 'normal'}
        data={listData}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        onViewableItemsChanged={selectMode ? onViewableItemsChanged : undefined}
        viewabilityConfig={viewabilityConfig}
        stickyHeaderIndices={stickyIndices}
        contentContainerStyle={{ paddingBottom: 48 }}
        removeClippedSubviews={false}
      />

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

  // Section header (sticky — wraps select bar + section title as one unit)
  sectionBlock: { backgroundColor: Colors.background },
  sectionHeader: { backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  sectionCount: { fontSize: 14, color: '#888' },
  sectionSub: { fontSize: 13, color: '#666' },
  sectionSelectLink: { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },

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
  lbMeta: { fontSize: 12, color: '#555', textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  lbSwipeHint: { fontSize: 10, color: '#333', textAlign: 'center', paddingBottom: 10 },
});
