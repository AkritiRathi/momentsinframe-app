import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView,
  Modal, Alert, ActivityIndicator, Dimensions, PanResponder,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  getEventPhotos, getPhotoUrls, getUploadUrl, processUpload, deletePhotos,
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

type UploadProgress = {
  current: number;
  total: number;
  duplicates: number;
  failed: number;
};

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
        } catch { /* skip failed batches */ }
      })
    );
  }

  const lightboxPhotos = lightboxSection === 'main' ? photos : otherPhotos;

  function openLightbox(index: number, section: 'main' | 'other') {
    if (selectMode) return;
    setLightboxIndex(index);
    setLightboxSection(section);
    setLightboxVisible(true);
  }

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

  function selectAll(items: Photo[]) {
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(p => next.add(p.id));
      return next;
    });
  }

  function deselectAll(items: Photo[]) {
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(p => next.delete(p.id));
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
    setUploadProgress({ current: 0, total: assets.length, duplicates: 0, failed: 0 });

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
        const fileResponse = await fetch(asset.uri);
        const blob = await fileResponse.blob();
        const putRes = await fetch(uploadUrl, {
          method: 'PUT', body: blob, headers: { 'Content-Type': contentType },
        });
        if (!putRes.ok) { failed++; continue; }

        const processResult = await processUpload(slug, stagingKey, filename);
        if (processResult.duplicate) duplicates++;
        else if (processResult.error) failed++;
      } catch {
        failed++;
      }

      setUploadProgress({ current: i + 1, total: assets.length, duplicates, failed });
    }

    setUploading(false);

    const uploaded = uploadProgress.current - duplicates - failed;
    const parts: string[] = [];
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

  async function handleDownloadPhoto(id: string) {
    const urls = photoUrls[id];
    if (!urls?.url) { Alert.alert('Not available', 'Photo URL not loaded yet.'); return; }
    try {
      const filename = urls.originalFilename ?? `photo_${id}.jpg`;
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.downloadAsync(urls.url, localUri);
      await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg' });
    } catch {
      Alert.alert('Error', 'Could not download photo.');
    }
  }

  const currentPhoto = lightboxPhotos[lightboxIndex];
  const currentUrls = currentPhoto ? photoUrls[currentPhoto.id] : null;
  const lightboxImageUrl = currentUrls?.displayUrl ?? currentUrls?.url ?? null;

  const daysLeft = params.expiresAt ? daysUntil(params.expiresAt) : 999;
  const totalPhotos = photos.length + otherPhotos.length;
  const allSelected = [...photos, ...otherPhotos].every(p => selected.has(p.id));

  function renderThumb(photo: Photo, index: number, section: 'main' | 'other') {
    const urls = photoUrls[photo.id];
    const isSelected = selected.has(photo.id);
    return (
      <TouchableOpacity
        key={photo.id}
        style={styles.thumb}
        onPress={() => selectMode ? toggleSelect(photo.id) : openLightbox(index, section)}
        activeOpacity={0.85}
      >
        {urls?.thumbUrl ? (
          <Image source={{ uri: urls.thumbUrl }} style={styles.thumbImage} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <View style={styles.thumbSkeleton} />
          </View>
        )}
        {selectMode && (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
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
          <View key={`e${k}`} style={{ width: THUMB_SIZE }} />
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

  return (
    <SafeAreaView style={styles.container}>

      {/* Upload progress overlay */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadCard}>
            <View style={styles.uploadCardHeader}>
              <Text style={styles.uploadCardTitle}>Uploading photos</Text>
              <TouchableOpacity onPress={() => { uploadCancelledRef.current = true; }}>
                <Text style={styles.uploadCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.uploadCardSub}>
              {uploadProgress.current} of {uploadProgress.total} uploaded
              {uploadProgress.duplicates > 0 ? ` · ${uploadProgress.duplicates} duplicate${uploadProgress.duplicates > 1 ? 's' : ''} skipped` : ''}
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, {
                width: `${uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}%` as any,
              }]} />
            </View>
            <Text style={styles.uploadPct}>
              {uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}% complete — keep this screen open
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

            <View style={styles.lbImageWrap}>
              {lightboxImageUrl ? (
                <Image source={{ uri: lightboxImageUrl }} style={styles.lbImage} resizeMode="contain" />
              ) : (
                <ActivityIndicator color={Colors.accent} />
              )}
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

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerBody}>
            <Text style={styles.eventName}>{params.name || 'Event'}</Text>
            <Text style={styles.eventMeta}>
              {params.createdAt ? `Created on ${formatDate(params.createdAt)}` : ''}
              {params.createdAt && params.expiresAt ? ' · ' : ''}
              {params.expiresAt ? `Event expires ${formatDate(params.expiresAt)}` : ''}
            </Text>
            <Text style={styles.photoCountText}>
              {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}
              {otherPhotos.length > 0 ? ` (${photos.length} in Photo Gallery, ${otherPhotos.length} in Other Photos Gallery)` : ''}
            </Text>
          </View>
        </View>

        {/* Expiry warning */}
        {daysLeft <= 3 && (
          <View style={styles.expiryBanner}>
            <Text style={styles.expiryBannerText}>
              {daysLeft < 0
                ? 'This event has closed. Download your photos before they are removed.'
                : daysLeft === 0
                ? `This event closes today. Download your photos before then.`
                : daysLeft === 1
                ? `This event closes tomorrow. Download your photos before then.`
                : `This event closes in ${daysLeft} days. Download your photos before then.`}
            </Text>
          </View>
        )}

        {/* Upload card */}
        <View style={styles.uploadCard2}>
          <TouchableOpacity
            style={[styles.uploadBtn, uploading && { opacity: 0.5 }]}
            onPress={showUploadOptions}
            disabled={uploading}
          >
            <Text style={styles.uploadBtnText}>Upload Photos</Text>
          </TouchableOpacity>
          <Text style={styles.uploadHint}>
            You can upload multiple photos at a time. Keep this screen open while uploading.
          </Text>
        </View>

        {/* Select photos button (when not in select mode) */}
        {totalPhotos > 0 && !selectMode && (
          <View style={styles.selectRow}>
            <TouchableOpacity style={styles.selectPhotosBtn} onPress={() => setSelectMode(true)}>
              <Text style={styles.selectPhotosBtnText}>Select photos</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Select mode bar — inline in scroll, not floating */}
        {selectMode && (
          <View style={styles.selectBar}>
            <View style={styles.selectBarLeft}>
              <Text style={styles.selectCount}>{selected.size}</Text>
              <Text style={styles.selectCountLabel}>selected</Text>
            </View>
            <TouchableOpacity
              style={styles.selectBarBtn}
              onPress={() => allSelected ? deselectAll([...photos, ...otherPhotos]) : selectAll([...photos, ...otherPhotos])}
            >
              <Text style={styles.selectBarBtnText}>Select all</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selectBarBtn} onPress={exitSelectMode}>
              <Text style={styles.selectBarBtnText}>Cancel</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.selectBarBtn, styles.selectBarBtnDel, selected.size === 0 && { opacity: 0.4 }]}
                disabled={selected.size === 0}
                onPress={handleBulkDelete}
              >
                <Text style={[styles.selectBarBtnText, { color: Colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.selectBarBtnPrimary, selected.size === 0 && { opacity: 0.4 }]}
              disabled={selected.size === 0}
              onPress={() => Alert.alert('Coming soon', 'Bulk download will be available soon.')}
            >
              <Text style={styles.selectBarBtnPrimaryText}>↓ Download</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Gallery sections */}
        {photos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>Photo Gallery</Text>
                <Text style={styles.sectionCount}>{photos.length}</Text>
              </View>
              <Text style={styles.sectionSub}>(sorted by date taken · oldest first)</Text>
              {selectMode && (
                <View style={styles.sectionSelectRow}>
                  <TouchableOpacity onPress={() => {
                    const allInSection = photos.every(p => selected.has(p.id));
                    allInSection ? deselectAll(photos) : selectAll(photos);
                  }}>
                    <Text style={styles.sectionSelectLink}>
                      {photos.every(p => selected.has(p.id)) ? 'Deselect all Photo Gallery' : 'Select all Photo Gallery'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <View style={styles.grid}>{renderGrid(photos, 'main')}</View>
          </View>
        )}

        {otherPhotos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>Other Photos Gallery</Text>
                <Text style={styles.sectionCount}>{otherPhotos.length}</Text>
              </View>
              <Text style={styles.sectionSub}>(no date info — sorted by upload time)</Text>
              {selectMode && (
                <View style={styles.sectionSelectRow}>
                  <TouchableOpacity onPress={() => {
                    const allInSection = otherPhotos.every(p => selected.has(p.id));
                    allInSection ? deselectAll(otherPhotos) : selectAll(otherPhotos);
                  }}>
                    <Text style={styles.sectionSelectLink}>
                      {otherPhotos.every(p => selected.has(p.id)) ? 'Deselect all Other Photos Gallery' : 'Select all Other Photos Gallery'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <View style={styles.grid}>{renderGrid(otherPhotos, 'other')}</View>
          </View>
        )}

        {totalPhotos === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No photos yet.</Text>
            <Text style={styles.emptySub}>Be the first to upload!</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 48 },

  // Header
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  backBtn: { marginRight: 12, paddingTop: 3 },
  backText: { fontSize: 24, color: Colors.textMuted },
  headerBody: { flex: 1, alignItems: 'center' },
  eventName: { fontSize: 22, fontWeight: '600', color: Colors.white, textAlign: 'center', marginBottom: 4 },
  eventMeta: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 2 },
  photoCountText: { fontSize: 13, color: '#666', textAlign: 'center' },

  // Expiry banner
  expiryBanner: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', backgroundColor: 'rgba(245,158,11,0.08)', paddingHorizontal: 14, paddingVertical: 10 },
  expiryBannerText: { fontSize: 13, color: '#D97706', lineHeight: 20 },

  // Upload card
  uploadCard2: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.cardBorder, backgroundColor: Colors.card, padding: 16, alignItems: 'center' },
  uploadBtn: { backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, marginBottom: 10 },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: Colors.white },
  uploadHint: { fontSize: 12, color: '#666', textAlign: 'center', lineHeight: 18 },

  // Select photos button
  selectRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, marginBottom: 12 },
  selectPhotosBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  selectPhotosBtnText: { fontSize: 14, fontWeight: '500', color: Colors.textMuted },

  // Select mode bar
  selectBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.card, borderBottomWidth: 0.5, borderBottomColor: Colors.cardBorder, gap: 6, flexWrap: 'wrap' },
  selectBarLeft: { flexDirection: 'column', marginRight: 4 },
  selectCount: { fontSize: 20, fontWeight: '500', color: Colors.white, lineHeight: 22 },
  selectCountLabel: { fontSize: 11, color: '#666', marginTop: 1 },
  selectBarBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  selectBarBtnText: { fontSize: 13, color: Colors.textMuted },
  selectBarBtnDel: { borderColor: 'rgba(229,57,53,0.3)' },
  selectBarBtnPrimary: { backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectBarBtnPrimaryText: { fontSize: 13, fontWeight: '600', color: Colors.white },

  // Section
  section: { marginBottom: 24 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  sectionCount: { fontSize: 14, color: '#888' },
  sectionSub: { fontSize: 13, color: '#666' },
  sectionSelectRow: { marginTop: 6 },
  sectionSelectLink: { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },

  // Grid
  grid: { gap: GAP },
  gridRow: { flexDirection: 'row', gap: GAP },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, backgroundColor: '#1a1a1a' },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: { flex: 1 },
  thumbSkeleton: { flex: 1, backgroundColor: '#252525' },
  checkbox: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.white, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: Colors.background, borderColor: Colors.background },
  checkboxTick: { fontSize: 11, fontWeight: '800', color: Colors.white },

  // Empty
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '500', color: Colors.textMuted, marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#444' },

  // Upload overlay
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  uploadCard: { width: '100%', backgroundColor: Colors.card, borderRadius: 16, padding: 20 },
  uploadCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  uploadCardTitle: { fontSize: 16, fontWeight: '600', color: Colors.white },
  uploadCancelText: { fontSize: 13, color: Colors.danger },
  uploadCardSub: { fontSize: 13, color: Colors.textMuted, marginBottom: 10 },
  progressBarBg: { height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: '100%', backgroundColor: Colors.white, borderRadius: 4 },
  uploadPct: { fontSize: 11, color: '#666' },

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
  lbImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  lbImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lbArrow: { position: 'absolute', top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' },
  lbArrowText: { fontSize: 36, color: 'rgba(255,255,255,0.35)' },
  lbMeta: { fontSize: 12, color: '#555', textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  lbSwipeHint: { fontSize: 10, color: '#333', textAlign: 'center', paddingBottom: 10 },
});
