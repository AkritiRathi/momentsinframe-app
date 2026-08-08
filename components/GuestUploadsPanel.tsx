import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Modal, ActivityIndicator,
  ScrollView, Dimensions, Platform, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
try { PhotoSaver = require('photo-saver').default; } catch {}
import { getEventPhotos, getPhotoUrls, deletePhotos, prepareZip } from '../lib/api';
import { API_BASE_URL } from '../constants/config';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert } from '../lib/useAlert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const THUMB_SIZE = Math.floor((SCREEN_WIDTH - 4) / 3);
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

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
  const prevSelectedSize = React.useRef(0);

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

  useEffect(() => {
    if (!visible || !guest) return;
    setMode('normal');
    setSelected(new Set());
    setLightboxVisible(false);
    fetchPhotos();
  }, [visible, guest?.mobile]);

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

  const grouped = React.useMemo(() => {
    const groups: { date: string; photos: GuestPhotoItem[] }[] = [];
    for (const photo of photos) {
      const existing = groups.find(g => g.date === photo.date);
      if (existing) existing.photos.push(photo);
      else groups.push({ date: photo.date, photos: [photo] });
    }
    return groups;
  }, [photos]);

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
          ? `${eventSlug}-${guest!.mobile}-part${i + 1}of${batches.length}.zip`
          : `${eventSlug}-${guest!.mobile}.zip`;
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
          const filename = `${eventSlug}_${id}.jpg`;
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

  const showDeleteBtn = viewerRole === 'organiser' || guest?.role === 'user' || guest?.mobile === adminPhone;

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

  const lightboxPhoto = photos[lightboxIndex] ?? null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {
      if (lightboxVisible) { setLightboxVisible(false); return; }
      if (mode !== 'normal') { cancelMode(); return; }
      onClose();
    }}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header — matches event screen layout */}
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

        {/* Action buttons / select bar */}
        {!loading && !error && photos.length > 0 && renderActionRow()}

        {/* Content */}
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
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.galleryHeading}>
              <Text style={styles.galleryTitle}>Photo Gallery <Text style={styles.galleryCount}>{photos.length}</Text></Text>
            </View>
            <Text style={styles.gallerySub}>(grouped by date · oldest first)</Text>

            {grouped.map(group => (
              <View key={group.date}>
                <Text style={styles.dateHeader}>{group.date}</Text>
                {chunk(group.photos, 3).map((row, rowIdx) => (
                  <View key={rowIdx} style={styles.photoRow}>
                    {row.map((photo, colIdx) => {
                      const isSelected = selected.has(photo.id);
                      return (
                        <TouchableOpacity
                          key={photo.id}
                          style={[styles.thumb, colIdx < row.length - 1 && { marginRight: 2 }]}
                          activeOpacity={0.85}
                          onPress={() => {
                            if (mode !== 'normal') {
                              toggleSelect(photo.id);
                            } else {
                              setLightboxIndex(photos.indexOf(photo));
                              setLightboxVisible(true);
                            }
                          }}
                        >
                          <ExpoImage
                            source={{ uri: photo.thumbUrl ?? undefined }}
                            style={styles.thumbImg}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                          {mode !== 'normal' && (
                            <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                              {isSelected && <Text style={styles.checkMark}>✓</Text>}
                            </View>
                          )}
                          {isSelected && <View style={styles.selectedOverlay} />}
                        </TouchableOpacity>
                      );
                    })}
                    {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
                      <View key={`empty-${i}`} style={[styles.thumb, { backgroundColor: 'transparent' }]} />
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}

        {alertOverlay}
      </View>

      {/* Lightbox */}
      {lightboxVisible && lightboxPhoto && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
          <View style={styles.lightboxContainer}>
            <ExpoImage
              source={{ uri: lightboxPhoto.fullUrl ?? lightboxPhoto.thumbUrl ?? undefined }}
              style={styles.lightboxImg}
              contentFit="contain"
            />
            <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxVisible(false)}>
              <Text style={styles.lightboxCloseText}>✕</Text>
            </TouchableOpacity>
            {lightboxIndex > 0 && (
              <TouchableOpacity style={styles.lightboxLeft} onPress={() => setLightboxIndex(i => i - 1)}>
                <Text style={styles.lightboxArrow}>‹</Text>
              </TouchableOpacity>
            )}
            {lightboxIndex < photos.length - 1 && (
              <TouchableOpacity style={styles.lightboxRight} onPress={() => setLightboxIndex(i => i + 1)}>
                <Text style={styles.lightboxArrow}>›</Text>
              </TouchableOpacity>
            )}
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header — mirrors event screen
  eventHeader: { paddingTop: 16, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  eventHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backText: { fontSize: 24, color: Colors.textMuted },
  appNameText: { fontSize: 18, fontWeight: '800', color: Colors.white, letterSpacing: 0.3 },
  eventHeaderBody: { alignItems: 'center' },
  guestName: { fontSize: 18, fontWeight: '600', color: Colors.white, textAlign: 'center' },
  guestContactLine: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 2 },
  guestMetaLine: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 2 },

  // Normal mode buttons — mirrors event screen selectPhotosRow
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
  scrollContent: { paddingBottom: 32 },
  galleryHeading: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 },
  galleryTitle: { fontSize: 18, fontWeight: '700', color: Colors.white },
  galleryCount: { fontSize: 16, fontWeight: '400', color: '#777' },
  gallerySub: { fontSize: 12, color: '#555', paddingHorizontal: 16, marginBottom: 8 },
  dateHeader: { fontSize: 14, fontWeight: '700', color: Colors.white, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  photoRow: { flexDirection: 'row', marginBottom: 2 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  checkCircle: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.white, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  checkCircleSelected: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkMark: { fontSize: 12, color: Colors.background, fontWeight: '700' },
  selectedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(245,200,66,0.18)', borderWidth: 2, borderColor: Colors.accent },

  // States
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 12 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 0.5, borderColor: '#333' },
  retryBtnText: { fontSize: 13, color: Colors.textMuted },

  // Lightbox
  lightboxContainer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: SCREEN_WIDTH, height: '100%' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 10 },
  lightboxCloseText: { fontSize: 24, color: Colors.white },
  lightboxLeft: { position: 'absolute', left: 16, padding: 12 },
  lightboxRight: { position: 'absolute', right: 16, padding: 12 },
  lightboxArrow: { fontSize: 40, color: Colors.white, opacity: 0.8 },
});
