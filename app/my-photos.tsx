import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Dimensions, Platform, Modal, Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
try { PhotoSaver = require('photo-saver').default; } catch {}
import { findMyPhotos, getPhotoUrls, prepareZip } from '../lib/api';
import { API_BASE_URL } from '../constants/config';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert } from '../lib/useAlert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLS = 3;
const GAP = 2;
const THUMB_SIZE = Math.floor((SCREEN_WIDTH - GAP * (COLS + 1)) / COLS);
const JPG_LIMIT = 40;
const PRIVACY_KEY = 'myPhotosPrivacySeen';

type MainPhoto = { id: string; taken_at: string };
type OtherPhoto = { id: string; created_at: string };
type PhotoUrls = { url?: string; thumbUrl?: string; displayUrl?: string };
type Mode = 'camera' | 'searching' | 'results';

type ListItem =
  | { type: 'section_header'; label: string; key: string }
  | { type: 'date_header'; date: string; key: string }
  | { type: 'photo_row'; ids: string[]; startIndex: number; key: string };

function formatDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function MyPhotosScreen() {
  const params = useLocalSearchParams<{
    slug: string; adminPhone: string; userMobile: string;
    eventName: string; totalPhotos: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert, alertOverlay } = useAlert();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [mode, setMode] = useState<Mode>('camera');
  const [photos, setPhotos] = useState<MainPhoto[]>([]);
  const [otherPhotos, setOtherPhotos] = useState<OtherPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, PhotoUrls>>({});
  const [capturing, setCapturing] = useState(false);
  const [downloadMode, setDownloadMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const slug = params.slug;
  const adminPhone = params.adminPhone || undefined;
  const userMobile = params.userMobile || undefined;
  const totalPhotos = parseInt(params.totalPhotos ?? '0', 10);

  // Combined flat list for lightbox indexing
  const allIds = useMemo(() => [
    ...photos.map(p => p.id),
    ...otherPhotos.map(p => p.id),
  ], [photos, otherPhotos]);

  const totalFound = allIds.length;

  // Build flat FlatList items
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
        items.push({ type: 'date_header', date: g.date, key: `date_main_${g.date}` });
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
        const d = formatDateLabel(p.created_at);
        const last = groups[groups.length - 1];
        if (last && last.date === d) last.ids.push(p.id);
        else groups.push({ date: d, ids: [p.id] });
      }
      let globalIdx = mainCount;
      for (const g of groups) {
        items.push({ type: 'date_header', date: g.date, key: `date_other_${g.date}` });
        for (let i = 0; i < g.ids.length; i += COLS) {
          items.push({ type: 'photo_row', ids: g.ids.slice(i, i + COLS), startIndex: globalIdx + i, key: `row_other_${g.date}_${i}` });
        }
        globalIdx += g.ids.length;
      }
    }

    return items;
  }, [photos, otherPhotos]);

  useEffect(() => {
    async function init() {
      if (!cameraPermission?.granted) await requestCameraPermission();
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
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5, exif: false });
      if (!photo?.base64) { setCapturing(false); return; }
      setMode('searching');
      const result = await findMyPhotos(slug, photo.base64, adminPhone, userMobile);
      if (result.error) {
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
    } catch {
      showAlert('Error', 'Something went wrong. Please try again.', [{ text: 'OK', onPress: () => setMode('camera') }]);
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

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
      const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`) ?? slug;
      let saved = 0;
      for (const id of ids) {
        try {
          const filename = `${slug}_${id}.jpg`;
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
              await PhotoSaver.saveToPhotos(cacheUri, 0, slug);
            } else {
              await MediaLibrary.saveToLibraryAsync(cacheUri);
            }
          }
          await FileSystem.deleteAsync(cacheUri, { idempotent: true });
          saved++;
        } catch {}
      }
      setDownloadMode(false);
      setSelected(new Set());
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
          ? `${slug}-my-photos-part${i + 1}of${batches.length}.zip`
          : `${slug}-my-photos.zip`;
        const zipRes = await prepareZip(slug, batches[i], adminPhone);
        if (zipRes.error) throw new Error(zipRes.error);
        const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
        const dlResult = await FileSystem.downloadAsync(zipRes.zipUrl, cacheUri);
        if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
        if (Platform.OS === 'android') {
          const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`) ?? slug;
          const localPath = dlResult.uri.replace('file://', '');
          await MediaStore.saveToDownloads(localPath, filename, folderName, 'application/zip');
        } else {
          await Sharing.shareAsync(cacheUri, { mimeType: 'application/zip', dialogTitle: 'Save ZIP' });
        }
        await FileSystem.deleteAsync(cacheUri, { idempotent: true });
      }
      setDownloadMode(false);
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

  // ── Camera screen ──────────────────────────────────────────────────────────
  if (mode === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {cameraPermission?.granted ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
        ) : (
          <View style={styles.permDenied}>
            <Text style={styles.permDeniedText}>Camera access is needed to take a selfie.{'\n'}Please enable it in Settings.</Text>
          </View>
        )}
        <View style={[styles.cameraHeader, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.camBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>My Photos</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={[styles.cameraFooter, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.cameraHint}>Take a selfie to find photos of yourself</Text>
          <TouchableOpacity style={styles.captureBtn} onPress={handleTakeSelfie} disabled={capturing || !cameraPermission?.granted}>
            {capturing
              ? <ActivityIndicator color="#000" />
              : <View style={styles.captureBtnInner} />
            }
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
        <Text style={styles.searchingText}>
          Searching through {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}…
        </Text>
      </View>
    );
  }

  // ── Results screen ──────────────────────────────────────────────────────────
  const currentLbId = allIds[lightboxIndex];
  const currentLbUrls = photoUrls[currentLbId];
  const lightboxImageUrl = currentLbUrls?.displayUrl ?? currentLbUrls?.url ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (downloadMode) { setDownloadMode(false); setSelected(new Set()); return; }
          router.back();
        }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>My Photos</Text>
          {totalFound > 0 && (
            <Text style={styles.headerSub}>{totalFound} photo{totalFound !== 1 ? 's' : ''} found</Text>
          )}
        </View>
        <View style={{ width: 32 }} />
      </View>

      {totalFound === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No photos of you were found in this event.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setMode('camera')}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {!downloadMode ? (
            <TouchableOpacity style={styles.downloadModeBtn} onPress={() => setDownloadMode(true)}>
              <Text style={styles.downloadModeBtnText}>Download Photos</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.selectBar}>
              <TouchableOpacity onPress={() => {
                if (selected.size === totalFound) setSelected(new Set());
                else setSelected(new Set(allIds));
              }}>
                <Text style={styles.selectAllText}>{selected.size === totalFound ? 'Deselect All' : 'Select All'}</Text>
              </TouchableOpacity>
              <Text style={styles.selectCount}>{selected.size} selected</Text>
              <TouchableOpacity
                style={[styles.dlBtn, selected.size === 0 && { opacity: 0.4 }]}
                disabled={selected.size === 0 || actionLoading}
                onPress={handleDownload}
              >
                {actionLoading
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Text style={styles.dlBtnText}>Download</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          <FlatList
            data={listItems}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item }) => {
              if (item.type === 'section_header') {
                return (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{item.label}</Text>
                  </View>
                );
              }
              if (item.type === 'date_header') {
                return (
                  <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>{item.date}</Text>
                  </View>
                );
              }
              // photo_row
              return (
                <View style={styles.photoRow}>
                  {item.ids.map((id, idx) => {
                    const urls = photoUrls[id];
                    const isSelected = selected.has(id);
                    const globalIndex = item.startIndex + idx;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[styles.thumb, idx < COLS - 1 && { marginRight: GAP }]}
                        activeOpacity={0.8}
                        onPress={() => downloadMode ? toggleSelect(id) : (() => { setLightboxIndex(globalIndex); setLightboxVisible(true); })()}
                      >
                        {urls?.thumbUrl || urls?.url ? (
                          <ExpoImage
                            source={{ uri: urls.thumbUrl ?? urls.url }}
                            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumbPlaceholder]}>
                            <ActivityIndicator color={Colors.accent} />
                          </View>
                        )}
                        {downloadMode && (
                          <View style={[styles.checkOverlay, isSelected && styles.checkOverlaySelected]}>
                            {isSelected && <Text style={styles.checkMark}>✓</Text>}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {/* Fill empty cells in last row */}
                  {item.ids.length < COLS && Array.from({ length: COLS - item.ids.length }).map((_, i) => (
                    <View key={`empty_${i}`} style={{ width: THUMB_SIZE, marginRight: i < COLS - item.ids.length - 1 ? GAP : 0 }} />
                  ))}
                </View>
              );
            }}
          />
        </>
      )}

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={styles.lightbox}>
          <View style={[styles.lbHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setLightboxVisible(false)}>
              <Text style={styles.lbBack}>←</Text>
            </TouchableOpacity>
            <Text style={styles.lbCounter}>{lightboxIndex + 1} / {totalFound}</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {lightboxImageUrl
              ? <Image source={{ uri: lightboxImageUrl }} style={styles.lbImg} resizeMode="contain" />
              : <ActivityIndicator color={Colors.accent} />
            }
          </View>
          <View style={[styles.lbFooter, { paddingBottom: insets.bottom + 12 }]}>
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
          {alertOverlay}
        </View>
      </Modal>

      {alertOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Camera
  cameraHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16,
  },
  camBackText: { fontSize: 24, color: '#fff' },
  cameraTitle: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  cameraFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', gap: 20,
  },
  cameraHint: { fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
  },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  permDenied: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permDeniedText: { color: '#fff', textAlign: 'center', fontSize: 15, lineHeight: 22 },

  // Searching
  centeredScreen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  searchingText: { fontSize: 15, color: Colors.textMuted, textAlign: 'center' },

  // Results header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#222',
  },
  backText: { fontSize: 24, color: Colors.textMuted },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 2 },

  // Section + date headers
  sectionHeader: {
    backgroundColor: Colors.background,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
    borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a',
  },
  sectionHeaderText: { fontSize: 13, fontWeight: '700', color: Colors.white, letterSpacing: 0.5, textTransform: 'uppercase' },
  dateHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  dateHeaderText: { fontSize: 12, color: '#888', fontWeight: '500' },

  // Photo grid
  photoRow: { flexDirection: 'row', paddingHorizontal: GAP, marginBottom: GAP },
  thumb: { overflow: 'hidden' },
  thumbPlaceholder: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderWidth: 2, borderColor: 'transparent',
  },
  checkOverlaySelected: {
    backgroundColor: 'rgba(245,200,66,0.25)',
    borderColor: Colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  checkMark: { fontSize: 28, color: Colors.accent, fontWeight: '700' },

  // Download bar
  downloadModeBtn: {
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: Colors.accent, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center',
  },
  downloadModeBtnText: { ...Typography.buttonText, color: Colors.background },
  selectBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#222',
  },
  selectAllText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },
  selectCount: { fontSize: 13, color: '#888' },
  dlBtn: { borderWidth: 1.5, borderColor: Colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  dlBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 20 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  retryBtn: { borderWidth: 1.5, borderColor: Colors.accent, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: Colors.accent },

  // Lightbox
  lightbox: { flex: 1, backgroundColor: '#000' },
  lbHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  lbBack: { fontSize: 24, color: '#fff' },
  lbCounter: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  lbImg: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lbFooter: { position: 'relative', height: 60 },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 60, justifyContent: 'center', alignItems: 'center' },
  lbArrowText: { fontSize: 40, color: '#fff' },
});
