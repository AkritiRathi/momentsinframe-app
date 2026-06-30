import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView,
  Modal, Alert, ActivityIndicator, Dimensions, PanResponder,
  ActionSheetIOS, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getEventPhotos, getPhotoUrls, getUploadUrl, processUpload, deletePhotos,
} from '../lib/api';
import { Colors } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_SIZE = (SCREEN_WIDTH - 2) / 3;

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

type UploadProgress = {
  current: number;
  total: number;
  duplicates: number;
  failed: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
  const [refreshing, setRefreshing] = useState(false);

  // Lightbox
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxSection, setLightboxSection] = useState<'main' | 'other'>('main');

  // Select mode (admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ current: 0, total: 0, duplicates: 0, failed: 0 });
  const uploadCancelledRef = useRef(false);

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

  async function loadPhotos(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await getEventPhotos(slug);
      if (data.error) { Alert.alert('Error', data.error); return; }
      const main: Photo[] = data.photos ?? [];
      const other: Photo[] = data.otherPhotos ?? [];
      setPhotos(main);
      setOtherPhotos(other);
      await loadAllUrls([...main, ...other], slug);
    } catch {
      Alert.alert('Error', 'Could not load photos. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadAllUrls(all: Photo[], eventSlug: string) {
    const ids = all.map(p => p.id);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await getPhotoUrls(eventSlug, batch);
          if (result.urls) {
            setPhotoUrls(prev => ({ ...prev, ...result.urls }));
          }
        } catch { /* silently skip failed batches */ }
      })
    );
  }

  function openLightbox(index: number, section: 'main' | 'other') {
    if (selectMode) return;
    setLightboxIndex(index);
    setLightboxSection(section);
    setLightboxVisible(true);
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

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleUpload(source: 'camera' | 'gallery') {
    const permResult = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert('Permission needed', `Please allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }

    const pickResult = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 1,
        });

    if (pickResult.canceled || !pickResult.assets || pickResult.assets.length === 0) return;

    const assets = pickResult.assets;
    uploadCancelledRef.current = false;
    setUploading(true);
    setUploadProgress({ current: 0, total: assets.length, duplicates: 0, failed: 0 });

    let duplicates = 0;
    let failed = 0;
    const newPhotoIds: string[] = [];

    for (let i = 0; i < assets.length; i++) {
      if (uploadCancelledRef.current) break;
      const asset = assets[i];
      const filename = asset.fileName ?? `photo_${Date.now()}.jpg`;
      const contentType = getMimeType(asset.uri);

      try {
        const urlResult = await getUploadUrl(slug, filename, contentType);
        if (urlResult.error) { failed++; continue; }

        const { uploadUrl, stagingKey } = urlResult;
        const fileResponse = await fetch(asset.uri);
        const blob = await fileResponse.blob();
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': contentType },
        });
        if (!putRes.ok) { failed++; continue; }

        const processResult = await processUpload(slug, stagingKey, filename);
        if (processResult.duplicate) {
          duplicates++;
        } else if (processResult.error) {
          failed++;
        } else if (processResult.photo?.id) {
          newPhotoIds.push(processResult.photo.id);
        }
      } catch {
        failed++;
      }

      setUploadProgress({ current: i + 1, total: assets.length, duplicates, failed });
    }

    setUploading(false);

    const parts: string[] = [];
    const uploaded = assets.length - duplicates - failed - (uploadCancelledRef.current ? (assets.length - uploadProgress.current) : 0);
    if (uploaded > 0) parts.push(`${uploaded} uploaded`);
    if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (parts.length > 0) Alert.alert('Upload complete', parts.join(' · '));

    await loadPhotos();
  }

  function showUploadOptions() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take a photo', 'Choose from library'], cancelButtonIndex: 0 },
        (i) => { if (i === 1) handleUpload('camera'); if (i === 2) handleUpload('gallery'); }
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

  async function handleDownloadPhoto(id: string) {
    const urls = photoUrls[id];
    const photoUrl = urls?.url;
    if (!photoUrl) { Alert.alert('Not available', 'Photo URL not loaded yet.'); return; }
    try {
      const filename = urls.originalFilename ?? `photo_${id}.jpg`;
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.downloadAsync(photoUrl, localUri);
      await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg' });
    } catch {
      Alert.alert('Error', 'Could not download photo.');
    }
  }

  const currentLightboxPhoto = lightboxPhotos[lightboxIndex];
  const currentLightboxUrls = currentLightboxPhoto ? photoUrls[currentLightboxPhoto.id] : null;
  const lightboxImageUrl = currentLightboxUrls?.displayUrl ?? currentLightboxUrls?.url ?? null;

  const daysLeft = daysUntil(params.expiresAt);
  const showExpiryBadge = daysLeft <= 3;

  function renderThumb(photo: Photo, index: number, section: 'main' | 'other') {
    const urls = photoUrls[photo.id];
    const isSelected = selected.has(photo.id);
    return (
      <TouchableOpacity
        key={photo.id}
        style={[styles.thumb, isSelected && styles.thumbSelected]}
        onPress={() => selectMode ? toggleSelect(photo.id) : openLightbox(index, section)}
        activeOpacity={0.8}
      >
        {urls?.thumbUrl ? (
          <Image source={{ uri: urls.thumbUrl }} style={styles.thumbImage} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <ActivityIndicator size="small" color="#333" />
          </View>
        )}
        {selectMode && isSelected && (
          <View style={styles.thumbCheck}><Text style={styles.thumbCheckText}>✓</Text></View>
        )}
      </TouchableOpacity>
    );
  }

  function renderGrid(items: Photo[], section: 'main' | 'other') {
    const rows: Photo[][] = [];
    for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
    return rows.map((row, ri) => (
      <View key={ri} style={styles.gridRow}>
        {row.map((p, ci) => renderThumb(p, ri * 3 + ci, section))}
        {row.length < 3 && Array(3 - row.length).fill(null).map((_, k) => (
          <View key={`empty-${k}`} style={{ width: THUMB_SIZE }} />
        ))}
      </View>
    ));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: 100 }} color={Colors.accent} />
      </SafeAreaView>
    );
  }

  const totalPhotos = photos.length + otherPhotos.length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Upload progress overlay */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <Text style={styles.uploadTitle}>Uploading photos…</Text>
          <View style={styles.progressBarWrap}>
            <View style={[styles.progressBarFill, {
              width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` as any,
            }]} />
          </View>
          <Text style={styles.uploadMeta}>
            {uploadProgress.current} of {uploadProgress.total} uploaded
            {uploadProgress.duplicates > 0 ? ` · ${uploadProgress.duplicates} duplicate${uploadProgress.duplicates > 1 ? 's' : ''} skipped` : ''}
            {uploadProgress.failed > 0 ? ` · ${uploadProgress.failed} failed` : ''}
          </Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => { uploadCancelledRef.current = true; }}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <View style={styles.lightbox} {...panResponder.panHandlers}>
          <SafeAreaView style={styles.lightbox}>
            <View style={styles.lbHeader}>
              <TouchableOpacity onPress={() => setLightboxVisible(false)}>
                <Text style={styles.lbBack}>←</Text>
              </TouchableOpacity>
              <Text style={styles.lbCounter}>{lightboxIndex + 1} / {lightboxPhotos.length}</Text>
              <View style={styles.lbActions}>
                <TouchableOpacity style={styles.lbActionBtn} onPress={() => currentLightboxPhoto && handleDownloadPhoto(currentLightboxPhoto.id)}>
                  <Text style={styles.lbActionText}>Download</Text>
                </TouchableOpacity>
                {isAdmin && (
                  <TouchableOpacity style={[styles.lbActionBtn, styles.lbActionDanger]} onPress={() => currentLightboxPhoto && handleDeletePhoto(currentLightboxPhoto.id)}>
                    <Text style={[styles.lbActionText, { color: Colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.lbImageWrap}>
              {lightboxImageUrl ? (
                <Image source={{ uri: lightboxImageUrl }} style={styles.lbImage} resizeMode="contain" />
              ) : (
                <ActivityIndicator color={Colors.accent} />
              )}
              {lightboxIndex > 0 && (
                <TouchableOpacity style={[styles.lbArrow, styles.lbArrowLeft]} onPress={() => navigateLightbox(-1)}>
                  <Text style={styles.lbArrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {lightboxIndex < lightboxPhotos.length - 1 && (
                <TouchableOpacity style={[styles.lbArrow, styles.lbArrowRight]} onPress={() => navigateLightbox(1)}>
                  <Text style={styles.lbArrowText}>›</Text>
                </TouchableOpacity>
              )}
            </View>

            {currentLightboxPhoto && (
              <Text style={styles.lbMeta}>
                {currentLightboxPhoto.taken_at
                  ? new Date(currentLightboxPhoto.taken_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : 'No date available'}
              </Text>
            )}
            <Text style={styles.lbSwipeHint}>Swipe left / right to navigate</Text>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Main content */}
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <View style={styles.headerTop}>
              <Text style={styles.eventName} numberOfLines={2}>{params.name}</Text>
              {showExpiryBadge && (
                <View style={styles.expiryBadge}>
                  <Text style={styles.expiryBadgeText}>
                    {daysLeft <= 0 ? 'Closed' : daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.headerMeta}>
              Created {formatDate(params.createdAt)} · Expires {formatDate(params.expiresAt)}
            </Text>
            <Text style={styles.photoCount}>{totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}</Text>
          </View>
        </View>

        {/* Upload bar */}
        <View style={styles.uploadBar}>
          <TouchableOpacity style={styles.uploadBtn} onPress={showUploadOptions}>
            <Text style={styles.uploadBtnText}>↑  Upload photos</Text>
          </TouchableOpacity>
        </View>

        {/* Admin select bar */}
        {isAdmin && !selectMode && (
          <View style={styles.adminBar}>
            <TouchableOpacity style={styles.selectBtn} onPress={() => setSelectMode(true)}>
              <Text style={styles.selectBtnText}>Select photos</Text>
            </TouchableOpacity>
            <Text style={styles.adminLabel}>Admin mode</Text>
          </View>
        )}

        {/* Select mode active bar */}
        {selectMode && (
          <View style={styles.selectActiveBar}>
            <Text style={styles.selCount}>{selected.size} selected</Text>
            <TouchableOpacity style={[styles.selBtn, styles.selBtnCancel]} onPress={exitSelectMode}>
              <Text style={[styles.selBtnText, { color: '#666' }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selBtn, styles.selBtnDl, selected.size === 0 && styles.selBtnDisabled]}
              disabled={selected.size === 0}
              onPress={async () => {
                Alert.alert('Coming soon', 'Bulk download will be available in the next update.');
              }}
            >
              <Text style={[styles.selBtnText, { color: Colors.accent }]}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selBtn, styles.selBtnDel, selected.size === 0 && styles.selBtnDisabled]}
              disabled={selected.size === 0}
              onPress={handleBulkDelete}
            >
              <Text style={[styles.selBtnText, { color: Colors.danger }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Photo gallery */}
        {photos.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>PHOTO GALLERY</Text>
            <View style={styles.grid}>{renderGrid(photos, 'main')}</View>
          </>
        )}

        {/* Other photos */}
        {otherPhotos.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: '#555' }]}>OTHER PHOTOS</Text>
            <View style={styles.grid}>{renderGrid(otherPhotos, 'other')}</View>
          </>
        )}

        {photos.length === 0 && otherPhotos.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No photos yet.</Text>
            <Text style={styles.emptySubText}>Be the first to upload!</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', padding: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  backBtn: { marginRight: 12, paddingTop: 2 },
  backText: { fontSize: 24, color: Colors.textMuted },
  headerContent: { flex: 1 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  eventName: { flex: 1, fontSize: 16, fontWeight: '800', color: Colors.white },
  expiryBadge: { backgroundColor: 'rgba(245,200,66,0.12)', borderWidth: 0.5, borderColor: 'rgba(245,200,66,0.3)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  expiryBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.accent },
  headerMeta: { fontSize: 10, color: '#555', marginBottom: 2 },
  photoCount: { fontSize: 10, color: '#444' },

  // Upload
  uploadBar: { padding: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  uploadBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' },
  uploadBtnText: { fontSize: 13, fontWeight: '800', color: Colors.background },

  // Admin bar
  adminBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(245,200,66,0.03)', borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  selectBtn: { borderWidth: 0.5, borderColor: 'rgba(245,200,66,0.3)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  selectBtnText: { fontSize: 11, fontWeight: '700', color: Colors.accent },
  adminLabel: { marginLeft: 'auto', fontSize: 10, color: '#444' },

  // Select active bar
  selectActiveBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#111', borderBottomWidth: 0.5, borderBottomColor: 'rgba(245,200,66,0.3)', gap: 6 },
  selCount: { fontSize: 12, fontWeight: '700', color: Colors.accent, flex: 1 },
  selBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 0.5 },
  selBtnCancel: { borderColor: '#2a2a2a' },
  selBtnDl: { borderColor: 'rgba(245,200,66,0.3)', backgroundColor: 'rgba(245,200,66,0.08)' },
  selBtnDel: { borderColor: 'rgba(229,57,53,0.3)', backgroundColor: 'rgba(229,57,53,0.08)' },
  selBtnDisabled: { opacity: 0.4 },
  selBtnText: { fontSize: 11, fontWeight: '700' },

  // Section
  sectionLabel: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 1, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },

  // Grid
  grid: { gap: 1 },
  gridRow: { flexDirection: 'row', gap: 1 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, backgroundColor: '#1a1a1a' },
  thumbSelected: { opacity: 0.6 },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbCheck: { position: 'absolute', top: 4, left: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  thumbCheckText: { fontSize: 9, fontWeight: '800', color: Colors.background },

  // Empty
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, fontWeight: '700', color: Colors.textMuted, marginBottom: 6 },
  emptySubText: { fontSize: 13, color: '#444' },

  // Upload overlay
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 100, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 },
  uploadTitle: { fontSize: 15, fontWeight: '700', color: Colors.white },
  progressBarWrap: { width: '100%', height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 2 },
  uploadMeta: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  cancelBtn: { borderWidth: 0.5, borderColor: '#333', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  cancelBtnText: { fontSize: 12, color: '#666' },

  // Lightbox
  lightbox: { flex: 1, backgroundColor: '#000' },
  lbHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  lbBack: { fontSize: 22, color: Colors.textMuted, marginRight: 12 },
  lbCounter: { fontSize: 12, color: '#555', flex: 1 },
  lbActions: { flexDirection: 'row', gap: 8 },
  lbActionBtn: { borderWidth: 0.5, borderColor: '#2a2a2a', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  lbActionDanger: { borderColor: 'rgba(229,57,53,0.3)' },
  lbActionText: { fontSize: 11, fontWeight: '700', color: '#888' },
  lbImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  lbImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 48, justifyContent: 'center', alignItems: 'center' },
  lbArrowLeft: { left: 0 },
  lbArrowRight: { right: 0 },
  lbArrowText: { fontSize: 32, color: 'rgba(255,255,255,0.35)' },
  lbMeta: { fontSize: 11, color: '#555', textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  lbSwipeHint: { fontSize: 9, color: '#333', textAlign: 'center', paddingBottom: 8 },
});
