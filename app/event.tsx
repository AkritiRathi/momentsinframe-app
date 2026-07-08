import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, Image, FlatList,
  Modal, ActivityIndicator, Dimensions, TextInput,
  Platform, BackHandler, AppState, RefreshControl,
} from 'react-native';
import MediaStore from 'media-store';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import RNFetchBlob from 'react-native-blob-util';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import BackgroundUpload from 'background-upload';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  getEventPhotos, getPhotoUrls, getUploadUrl, processUpload, deletePhotos,
  getPhotoDownloadUrl, prepareZip, changeEventAdminPassword,
} from '../lib/api';
import {
  getUserProfile, getEventUserId, getDeviceId,
  saveUploadNotification, getUploadNotifications, markNotificationsRead,
  deleteUploadNotification, mergeUploadNotification,
  saveLastEvent, clearLastEvent,
  type UploadNotification,
} from '../lib/storage';
import { setupNotifications, showUploadCompleteNotification, showDownloadCompleteNotification } from '../lib/notifications';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useAlert, alertStyles } from '../lib/useAlert';

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

type UploadFileResult = {
  status: 'success' | 'duplicate' | 'upgraded' | 'failed' | 'cancelled';
  section: 'main' | 'other' | null;
  existingPhotoId?: string;
  newPhotoId?: string;
  uri: string;
  filename: string;
};

function summarizeUploadResults(results: UploadFileResult[]): string {
  const mainSuccess = results.filter(r => r.status === 'success' && r.section === 'main').length;
  const otherSuccess = results.filter(r => r.status === 'success' && r.section === 'other').length;
  const upgraded = results.filter(r => r.status === 'upgraded').length;
  const duplicates = results.filter(r => r.status === 'duplicate').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const cancelled = results.filter(r => r.status === 'cancelled').length;
  const parts: string[] = [];
  if (mainSuccess > 0) parts.push(`${mainSuccess} added to Photo Gallery`);
  if (otherSuccess > 0) parts.push(`${otherSuccess} added to Other Photos Gallery`);
  if (upgraded > 0) parts.push(`${upgraded} better quality photo${upgraded > 1 ? 's' : ''} uploaded`);
  if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  return parts.join(' · ') || 'Nothing uploaded';
}

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

function SectionHeader({ section, items, selectMode, deleteMode, selected, onGroupToggle }: {
  section: 'main' | 'other';
  items: Photo[];
  selectMode: boolean;
  deleteMode: boolean;
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
        {(selectMode || deleteMode) && (
          <View style={styles.sectionSelectRow}>
            <TouchableOpacity onPress={() => onGroupToggle(items, !allSelected)}>
              <Text style={styles.sectionSelectLink}>
                {allSelected ? `Deselect all ${label}` : `Select all ${label}`}
              </Text>
            </TouchableOpacity>
            {!deleteMode && (
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
            )}
            {deleteMode && (
              <Text style={styles.deleteNote}>You can only delete photos that you have uploaded</Text>
            )}
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

// Module-level state shared with the background upload task
let _bgSlug = '';
let _bgDate: string = new Date().toISOString();
let _bgUserMobile: string | null = null;
let _bgUserName: string | null = null;
let _bgEventUserId: string | null = null;
let _bgProgressCb: ((current: number, total: number) => void) | null = null;
let _bgCompleteCb: ((results: UploadFileResult[], preSkipped: number) => void) | null = null;
let _bgCancelled = false;

async function backgroundUploadTask(): Promise<void> {
  const slug = _bgSlug;
  const userMobile = _bgUserMobile;
  const userName = _bgUserName;
  const eventUserId = _bgEventUserId;

  // Pre-check: collect already-uploaded filenames so exact matches are skipped.
  // Only include photos uploaded by the current user — same filename from a
  // different user is a different photo and must go through backend pHash detection.
  const existingFilenames = new Set<string>();
  try {
    const existingRes = await getEventPhotos(slug);
    if (!existingRes.error) {
      const allPhotos = [...(existingRes.photos ?? []), ...(existingRes.otherPhotos ?? [])];
      for (const p of allPhotos) {
        if (p.original_filename && userMobile && p.uploaded_by_mobile === userMobile) {
          existingFilenames.add(p.original_filename);
        }
      }
    }
  } catch {}

  // Find the Camera album so only camera photos are uploaded
  let cameraAlbum: MediaLibrary.Album | null = null;
  try {
    const albums = await MediaLibrary.getAlbumsAsync();
    cameraAlbum = albums.find(a => a.title === 'Camera') ?? null;
  } catch {}

  // Scan Camera album for photos taken on the selected date
  const selectedDate = new Date(_bgDate);
  const startOfDay = new Date(selectedDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(selectedDate);
  endOfDay.setHours(23, 59, 59, 999);

  let allAssets: MediaLibrary.Asset[] = [];
  try {
    let cursor: string | undefined;
    while (true) {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        createdAfter: startOfDay.getTime(),
        createdBefore: endOfDay.getTime(),
        first: 100,
        after: cursor,
        sortBy: MediaLibrary.SortBy.creationTime,
        ...(cameraAlbum ? { album: cameraAlbum } : {}),
      });
      allAssets = [...allAssets, ...page.assets];
      if (!page.hasNextPage) break;
      cursor = page.endCursor;
    }
  } catch {}

  // Filter out exact filename matches (already uploaded — skip without touching duplicate detection)
  const preSkipped = allAssets.filter(asset => existingFilenames.has(asset.filename)).length;
  const toUpload = allAssets.filter(asset => !existingFilenames.has(asset.filename));

  if (toUpload.length === 0) {
    _bgCompleteCb?.([], preSkipped);
    return;
  }

  // Pre-fetch all localURIs and presigned URLs in parallel before uploads start
  // Keep showing "Scanning gallery…" (total=0) during this phase
  const localUris = await Promise.all(toUpload.map(async (asset) => {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset.id);
      return info?.localUri ?? asset.uri;
    } catch { return asset.uri; }
  }));

  if (_bgCancelled) {
    _bgCompleteCb?.(toUpload.map((a, i) => ({ status: 'cancelled' as const, section: null, uri: localUris[i], filename: a.filename })), preSkipped);
    return;
  }

  const presignedUrls = await Promise.all(toUpload.map(async (asset, i) => {
    try { return await getUploadUrl(slug, asset.filename, getMimeType(localUris[i])); }
    catch { return { error: true as const }; }
  }));

  if (_bgCancelled) {
    _bgCompleteCb?.(toUpload.map((a, i) => ({ status: 'cancelled' as const, section: null, uri: localUris[i], filename: a.filename })), preSkipped);
    return;
  }

  // Pre-fetch done — now flip the card to "0 of N uploaded" and begin uploads
  _bgProgressCb?.(0, toUpload.length);
  try {
    await BackgroundUpload.updateService('Uploading photos', `0 of ${toUpload.length} uploaded`, 0, toUpload.length);
  } catch {}

  const results: UploadFileResult[] = new Array(toUpload.length);
  let completed = 0;
  const CONCURRENCY = 4;

  async function uploadOne(asset: MediaLibrary.Asset, index: number): Promise<void> {
    const filename = asset.filename;
    const uploadUri = localUris[index];
    const contentType = getMimeType(uploadUri);
    const urlResult = presignedUrls[index];
    let result: UploadFileResult;
    try {
      if (urlResult.error) {
        result = { status: 'failed', section: null, uri: asset.uri, filename };
      } else {
        const { uploadUrl, stagingKey } = urlResult;
        const upRes = await RNFetchBlob.fetch('PUT', uploadUrl,
          { 'Content-Type': contentType },
          RNFetchBlob.wrap(uploadUri),
        );
        const uploadOk = upRes.respInfo.status >= 200 && upRes.respInfo.status < 300;
        if (!uploadOk) {
          result = { status: 'failed', section: null, uri: asset.uri, filename };
        } else {
          const proc = await processUpload(slug, stagingKey, filename, userMobile ?? undefined, userName ?? undefined, eventUserId ?? undefined);
          if (proc.error) {
            result = { status: 'failed', section: null, uri: asset.uri, filename };
          } else if (proc.duplicate) {
            result = { status: 'duplicate', section: proc.inMainTimeline ? 'main' : 'other', existingPhotoId: proc.existingPhotoId, uri: asset.uri, filename };
          } else if (proc.upgraded) {
            result = { status: 'upgraded', section: proc.inMainTimeline ? 'main' : 'other', existingPhotoId: proc.existingPhotoId, newPhotoId: proc.photo?.id, uri: asset.uri, filename };
          } else {
            result = { status: 'success', section: proc.inMainTimeline ? 'main' : 'other', newPhotoId: proc.photo?.id, uri: asset.uri, filename };
          }
        }
      }
    } catch {
      result = { status: 'failed', section: null, uri: asset.uri, filename };
    }
    results[index] = result;
    completed += 1;
    _bgProgressCb?.(completed, toUpload.length);
    try {
      await BackgroundUpload.updateService('Uploading photos', `${completed} of ${toUpload.length} uploaded`, completed, toUpload.length);
    } catch {}
  }

  // Worker pool: always keep CONCURRENCY uploads in flight — no batch stall
  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (_bgCancelled) break;
      const i = nextIndex++;
      if (i >= toUpload.length) break;
      await uploadOne(toUpload[i], i);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (_bgCancelled) {
    for (let j = 0; j < toUpload.length; j++) {
      if (!results[j]) results[j] = { status: 'cancelled', section: null, uri: toUpload[j].uri, filename: toUpload[j].filename };
    }
  }

  _bgCompleteCb?.(results, preSkipped);
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
  const [eventUserId, setEventUserId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [newlyUploadedIds, setNewlyUploadedIds] = useState<Set<string>>(new Set());
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
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
  const [deleteMode, setDeleteMode] = useState(false);
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
  const [uploadCancelRequested, setUploadCancelRequested] = useState(false);
  const uploadCancelledRef = useRef(false);
  const downloadCancelledRef = useRef(false);
  const bgUploadCancelledRef = useRef(false);
  const retryNotifIdRef = useRef<string | null>(null);

  // Background upload by date
  const [bgUploading, setBgUploading] = useState(false);
  const [bgUploadProgress, setBgUploadProgress] = useState({ current: 0, total: 0 });
  const [bgCancelRequested, setBgCancelRequested] = useState(false);
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);
  const [datePickerDate, setDatePickerDate] = useState(new Date());

  // Admin settings
  const [adminSettingsVisible, setAdminSettingsVisible] = useState(false);
  const [adminDropPos, setAdminDropPos] = useState({ top: 0, right: 0 });
  const adminGearRef = useRef<any>(null);
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpShowNew, setCpShowNew] = useState(false);
  const [cpShowConfirm, setCpShowConfirm] = useState(false);
  const [cpError, setCpError] = useState('');
  const [folderSetupVisible, setFolderSetupVisible] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState('MomentsInFrame');
  const folderSetupResolveRef = useRef<((name: string | null) => void) | null>(null);
  const [duplicateResults, setDuplicateResults] = useState<UploadFileResult[]>([]);
  const [duplicateViewerVisible, setDuplicateViewerVisible] = useState(false);
  const [duplicateViewerIndex, setDuplicateViewerIndex] = useState(0);
  const [failedResults, setFailedResults] = useState<UploadFileResult[]>([]);
  const [failedViewerVisible, setFailedViewerVisible] = useState(false);
  const failedAssetsRef = useRef<ImagePicker.ImagePickerAsset[]>([]);
  const { showAlert, alertOverlay } = useAlert();

  // Notifications panel
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [notifications, setNotifications] = useState<UploadNotification[]>([]);
  const [hasUnread, setHasUnread] = useState(false);

  async function submitChangePassword() {
    setCpError('');
    if (!cpNew.trim() || !cpConfirm.trim()) {
      setCpError('Please fill in both fields.');
      return;
    }
    if (cpNew.trim() !== cpConfirm.trim()) {
      setCpError('Passwords do not match.');
      return;
    }
    const result = await changeEventAdminPassword(slug, params.adminPassword, cpNew.trim());
    if (result.error) {
      setCpError(result.error);
    } else {
      setChangePasswordVisible(false);
      setCpNew(''); setCpConfirm(''); setCpError('');
      showAlert('Done', 'Password updated successfully.');
    }
  }
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [downloadMode, setDownloadMode] = useState<'jpg' | 'zip'>('jpg');
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [downloadingPhoto, setDownloadingPhoto] = useState(false);
  const prevSelectedSize = useRef(0);

  const lightboxPhotosRef = useRef<Photo[]>([]);

  // Zoom / pan shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  async function refreshNotifications() {
    const notifs = await getUploadNotifications(slug);
    setNotifications(notifs);
    setHasUnread(notifs.some(n => !n.read));
  }

  useEffect(() => {
    setupNotifications();
    loadPhotos();
    getUserProfile().then(p => {
      if (p) {
        setUserMobile(p.mobile);
        setUserName(`${p.firstName} ${p.lastName}`.trim());
      }
    });
    getEventUserId().then(id => { if (id) setEventUserId(id); });
    getDeviceId().then(id => { if (id) setDeviceId(id); });
    refreshNotifications();
    saveLastEvent({
      slug: params.slug,
      name: params.name ?? '',
      expiresAt: params.expiresAt ?? '',
      createdAt: params.createdAt ?? '',
      isAdmin: params.isAdmin ?? 'false',
      adminPassword: params.adminPassword ?? '',
    });

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshNotifications();
    });
    return () => appStateSub.remove();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (uploading) {
        showAlert(
          'Cancel upload?',
          'Photos uploaded so far will be saved.',
          [
            { text: 'Stop Upload', style: 'destructive', onPress: () => { uploadCancelledRef.current = true; setUploadCancelRequested(true); } },
            { text: 'Keep Uploading', style: 'cancel' },
          ]
        );
        return true;
      }
      if (bgUploading) {
        showAlert(
          'Cancel upload?',
          'Photos uploaded so far will be saved.',
          [
            { text: 'Stop Upload', style: 'destructive', onPress: () => { bgUploadCancelledRef.current = true; _bgCancelled = true; setBgCancelRequested(true); } },
            { text: 'Keep Uploading', style: 'cancel' },
          ]
        );
        return true;
      }
      if (selectMode || deleteMode) {
        exitSelectMode();
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [selectMode, deleteMode, uploading, bgUploading]);

  useEffect(() => {
    const JPG_LIMIT = 25;
    if (selectMode && !deleteMode && prevSelectedSize.current <= JPG_LIMIT && selected.size > JPG_LIMIT) {
      showAlert(
        'Downloading as ZIP',
        `You've selected more than ${JPG_LIMIT} photos. When you tap Download, all selected photos will be bundled into a ZIP file — not downloaded as individual JPGs.\n\nTo download as individual JPGs instead, select ${JPG_LIMIT} or fewer photos.`,
        [{ text: 'Got it' }]
      );
    }
    prevSelectedSize.current = selected.size;
  }, [selected.size, selectMode, deleteMode]);

  async function loadPhotos() {
    setLoading(true);
    setUploadSummary(null);
    setNewlyUploadedIds(new Set());
    try {
      const data = await getEventPhotos(slug);
      if (data.error) { showAlert('Error', data.error); return; }
      const main: Photo[] = data.photos ?? [];
      const other: Photo[] = data.otherPhotos ?? [];
      setPhotos(main);
      setOtherPhotos(other);
      setLoading(false);
      loadAllUrls([...main, ...other]);
    } catch {
      showAlert('Error', 'Could not load photos. Check your connection.');
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
    setDeleteMode(false);
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
    if (!selectMode && !deleteMode) return;
    const y = e.nativeEvent.contentOffset.y;

    const newSelectBarSticky = selectBarYRef.current !== null && y >= selectBarYRef.current;
    setSelectBarSticky(prev => prev === newSelectBarSticky ? prev : newSelectBarSticky);

    let next: 'main' | 'other' | null = null;
    if (otherHeaderY.current !== null && y >= otherHeaderY.current) next = 'other';
    else if (mainHeaderY.current !== null && y >= mainHeaderY.current) next = 'main';
    setStickySection(prev => prev === next ? prev : next);
  }, [selectMode, deleteMode]);

  async function handleUpload(source: 'camera' | 'gallery', retryAssets?: ImagePicker.ImagePickerAsset[]) {
    let assets: ImagePicker.ImagePickerAsset[];

    if (retryAssets) {
      assets = retryAssets;
    } else {
      const permResult = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permResult.granted) {
        showAlert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings.`);
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
      assets = pickResult.assets;
      if (source === 'gallery' && assets.length === 40) {
        showAlert('40-photo limit reached', 'Upload these first, then upload more if needed.');
      }

      const shouldUpload = await new Promise<boolean>(resolve =>
        showAlert(
          'Start upload?',
          `Uploading ${assets.length} photo${assets.length !== 1 ? 's' : ''}. ${Platform.OS === 'ios' ? 'Keep the app open while uploading.' : 'You can close the app while uploading.'}`,
          [
            { text: 'Start Upload', onPress: () => resolve(true) },
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          ]
        )
      );
      if (!shouldUpload) return;
    }

    if (bgUploading) {
      showAlert('Upload in progress', 'A background upload is already running. Please wait for it to complete.');
      return;
    }

    bgUploadCancelledRef.current = false;
    _bgCancelled = false;
    setBgCancelRequested(false);
    setBgUploading(true);
    setBgUploadProgress({ current: 0, total: assets.length });
    setNewlyUploadedIds(new Set());
    setUploadSummary(null);

    // Pre-fetch all localURIs in parallel
    const localUris = await Promise.all(assets.map(async (asset) => {
      if (asset.assetId) {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.assetId);
          if (info?.localUri) return info.localUri;
        } catch {}
      }
      return asset.uri;
    }));

    if (bgUploadCancelledRef.current) {
      setBgUploading(false);
      setBgUploadProgress({ current: 0, total: 0 });
      setBgCancelRequested(false);
      return;
    }

    // Resolve filenames via MediaLibrary so individual uploads use the same
    // filename as Upload by Date — enabling accurate pre-check deduplication.
    // getAssetInfoAsync does not work reliably on Samsung S25 Ultra, so instead
    // fetch recent assets via getAssetsAsync (same API used by Upload by Date)
    // and build a URI→filename map. Single call regardless of selection size.
    let resolvedFilenames: string[];
    try {
      const recentAssets = await MediaLibrary.getAssetsAsync({
        first: 200,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: MediaLibrary.SortBy.modificationTime,
      });
      const idToFilename = new Map(
        recentAssets.assets
          .map(a => [a.uri.split('/').pop(), a.filename] as [string, string])
          .filter(([id]) => !!id)
      );
      resolvedFilenames = assets.map(a => {
        const numericId = a.uri?.split('/').pop();
        return (numericId ? idToFilename.get(numericId) : undefined) ?? a.fileName ?? `photo_${Date.now()}.jpg`;
      });
    } catch {
      resolvedFilenames = assets.map(a => a.fileName ?? `photo_${Date.now()}.jpg`);
    }

    // Pre-fetch all presigned URLs in parallel
    const presignedUrls = await Promise.all(assets.map(async (asset, i) => {
      const filename = resolvedFilenames[i];
      try { return await getUploadUrl(slug, filename, getMimeType(localUris[i])); }
      catch { return { error: true as const }; }
    }));

    if (bgUploadCancelledRef.current) {
      setBgUploading(false);
      setBgUploadProgress({ current: 0, total: 0 });
      setBgCancelRequested(false);
      return;
    }

    const CONCURRENCY = 4;
    const results: (UploadFileResult | null)[] = new Array(assets.length).fill(null);
    let completedCount = 0;

    async function uploadOne(asset: ImagePicker.ImagePickerAsset, index: number) {
      const filename = resolvedFilenames[index];
      const uploadUri = localUris[index];
      const contentType = getMimeType(uploadUri);
      const urlResult = presignedUrls[index];
      let result: UploadFileResult;

      if (bgUploadCancelledRef.current) {
        result = { status: 'cancelled', section: null, uri: asset.uri, filename };
      } else {
        try {
          if (urlResult.error) {
            result = { status: 'failed', section: null, uri: asset.uri, filename };
          } else {
            const { uploadUrl, stagingKey } = urlResult;
            const upRes = await RNFetchBlob.fetch('PUT', uploadUrl,
              { 'Content-Type': contentType },
              RNFetchBlob.wrap(uploadUri),
            );
            const uploadOk = upRes.respInfo.status >= 200 && upRes.respInfo.status < 300;
            if (!uploadOk) {
              result = { status: 'failed', section: null, uri: asset.uri, filename };
            } else {
              const proc = await processUpload(slug, stagingKey, filename, userMobile ?? undefined, userName ?? undefined, eventUserId ?? undefined);
              if (proc.error) {
                result = { status: 'failed', section: null, uri: asset.uri, filename };
              } else if (proc.duplicate) {
                result = { status: 'duplicate', section: proc.inMainTimeline ? 'main' : 'other', existingPhotoId: proc.existingPhotoId, uri: asset.uri, filename };
              } else if (proc.upgraded) {
                result = { status: 'upgraded', section: proc.inMainTimeline ? 'main' : 'other', existingPhotoId: proc.existingPhotoId, newPhotoId: proc.photo?.id, uri: asset.uri, filename };
              } else {
                result = { status: 'success', section: proc.inMainTimeline ? 'main' : 'other', newPhotoId: proc.photo?.id, uri: asset.uri, filename };
              }
            }
          }
        } catch {
          result = { status: 'failed', section: null, uri: asset.uri, filename };
        }
      }

      results[index] = result;
      completedCount++;
      setBgUploadProgress({ current: completedCount, total: assets.length });
    }

    // Worker pool: always keep CONCURRENCY uploads in flight — no batch stall
    let nextIndex = 0;
    async function worker() {
      while (true) {
        if (bgUploadCancelledRef.current) break;
        const i = nextIndex++;
        if (i >= assets.length) break;
        await uploadOne(assets[i], i);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const finalResults = results.filter(Boolean) as UploadFileResult[];

    setBgUploading(false);
    setBgUploadProgress({ current: 0, total: 0 });
    setBgCancelRequested(false);
    await loadPhotos();
    const newIds = finalResults
      .filter(r => r.status === 'success' || r.status === 'upgraded')
      .map(r => r.newPhotoId)
      .filter(Boolean) as string[];
    setNewlyUploadedIds(new Set(newIds));
    setUploadSummary(summarizeUploadResults(finalResults));

    const summary = summarizeUploadResults(finalResults);
    const dupsAndUpgrades = finalResults.filter(r => r.status === 'duplicate' || r.status === 'upgraded');
    const failed = finalResults.filter(r => r.status === 'failed');
    const failedAssets = assets.filter((_, i) => results[i]?.status === 'failed');

    const alertButtons: { text: string; onPress?: () => void }[] = [];
    if (dupsAndUpgrades.length > 0) {
      alertButtons.push({
        text: 'View duplicates',
        onPress: () => { setDuplicateResults(dupsAndUpgrades); setDuplicateViewerIndex(0); setDuplicateViewerVisible(true); },
      });
    }
    if (failed.length > 0) {
      failedAssetsRef.current = failedAssets;
      alertButtons.push({
        text: 'View failed',
        onPress: () => { setFailedResults(failed); setFailedViewerVisible(true); },
      });
    }
    alertButtons.push({ text: 'OK' });
    const notifPayload = {
      photosAdded: finalResults.filter(r => r.status === 'success').length,
      duplicatesSkipped: finalResults.filter(r => r.status === 'duplicate').length,
      upgradesFound: finalResults.filter(r => r.status === 'upgraded').length,
      failedCount: failed.length,
      duplicateData: dupsAndUpgrades,
      failedData: failed,
    };
    if (retryNotifIdRef.current) {
      await mergeUploadNotification(slug, retryNotifIdRef.current, notifPayload);
      retryNotifIdRef.current = null;
    } else {
      await saveUploadNotification(slug, { timestamp: new Date().toISOString(), source: 'individual', ...notifPayload });
    }
    await refreshNotifications();
    if (AppState.currentState !== 'active') {
      await showUploadCompleteNotification(summary);
    } else {
      showAlert('Upload complete', summary, alertButtons);
    }
  }

  async function startDateUpload(date: Date) {
    _bgCancelled = false;
    bgUploadCancelledRef.current = false;
    setBgCancelRequested(false);
    _bgSlug = slug;
    _bgDate = date.toISOString();
    _bgUserMobile = userMobile;
    _bgUserName = userName;
    _bgEventUserId = eventUserId;

    _bgProgressCb = (current: number, total: number) => {
      if (bgUploadCancelledRef.current) _bgCancelled = true;
      setBgUploadProgress({ current, total });
    };

    _bgCompleteCb = async (results: UploadFileResult[], preSkipped: number) => {
      _bgCompleteCb = null;
      try { await BackgroundUpload.stopService(); } catch {}
      deactivateKeepAwake();
      setBgUploading(false);
      setBgUploadProgress({ current: 0, total: 0 });
      setBgCancelRequested(false);
      await loadPhotos();
      const newIds = results
        .filter(r => r.status === 'success' || r.status === 'upgraded')
        .map(r => r.newPhotoId)
        .filter(Boolean) as string[];
      setNewlyUploadedIds(new Set(newIds));
      let summary: string;
      if (results.length === 0 && preSkipped > 0) {
        summary = `All ${preSkipped} photo${preSkipped > 1 ? 's' : ''} from this date were already uploaded. No new photos found.`;
      } else if (results.length === 0 && preSkipped === 0) {
        summary = 'No photos found for this date';
      } else {
        const base = summarizeUploadResults(results);
        summary = preSkipped > 0 ? `${base} · ${preSkipped} already uploaded` : base;
      }
      setUploadSummary(summary);
      const dupsAndUpgrades = results.filter(r => r.status === 'duplicate' || r.status === 'upgraded');
      const failedResults = results.filter(r => r.status === 'failed');
      const byDateNotifPayload = {
        photosAdded: results.filter(r => r.status === 'success').length,
        duplicatesSkipped: results.filter(r => r.status === 'duplicate').length,
        upgradesFound: results.filter(r => r.status === 'upgraded').length,
        failedCount: failedResults.length,
        duplicateData: dupsAndUpgrades,
        failedData: failedResults,
      };
      if (retryNotifIdRef.current) {
        await mergeUploadNotification(slug, retryNotifIdRef.current, byDateNotifPayload);
        retryNotifIdRef.current = null;
      } else {
        await saveUploadNotification(slug, { timestamp: new Date().toISOString(), source: 'by_date', uploadDate: _bgDate, preSkipped, ...byDateNotifPayload });
      }
      await refreshNotifications();
      if (AppState.currentState !== 'active') {
        await showUploadCompleteNotification(summary);
      } else if (dupsAndUpgrades.length > 0) {
        showAlert('Upload complete', summary, [
          { text: 'View duplicates', onPress: () => { setDuplicateResults(dupsAndUpgrades); setDuplicateViewerIndex(0); setDuplicateViewerVisible(true); } },
          { text: 'OK' },
        ]);
      }
    };

    setBgUploading(true);
    setBgUploadProgress({ current: 0, total: 0 });
    activateKeepAwakeAsync();

    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    try {
      await BackgroundUpload.startService('Uploading photos', `Scanning photos from ${dateStr}…`);
      backgroundUploadTask();
    } catch {
      setBgUploading(false);
      deactivateKeepAwake();
      showAlert('Upload failed', 'Could not start background upload. Please try again.');
    }
  }

  async function handleDateUpload() {
    if (bgUploading) {
      showAlert('Upload in progress', 'A background upload is already running. Please wait for it to complete.');
      return;
    }
    const perm = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    if (!perm.granted) {
      showAlert('Permission required', 'Please allow access to your photos and videos to use this feature.');
      return;
    }
    showAlert(
      'Upload by date',
      'This will upload all photos taken on the selected date from your Camera folder. Photos already uploaded by this feature will be skipped automatically.',
      [
        {
          text: 'Continue', onPress: () => {
            if (Platform.OS === 'android') {
              DateTimePickerAndroid.open({
                value: new Date(),
                mode: 'date',
                maximumDate: new Date(),
                onChange: (_event: any, date?: Date) => {
                  if (date) {
                    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                    showAlert(
                      'Upload photos from this date',
                      `Upload all photos from your Camera folder taken on ${dateStr}?`,
                      [
                        { text: 'Upload', onPress: () => startDateUpload(date) },
                        { text: 'Cancel', style: 'cancel' },
                      ]
                    );
                  }
                },
              });
            } else {
              setDatePickerDate(new Date());
              setShowDatePickerModal(true);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  function showUploadOptions() {
    if (Platform.OS === 'ios') {
      const { ActionSheetIOS } = require('react-native');
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Upload by date', 'Choose from library'], cancelButtonIndex: 0 },
        (i: number) => { if (i === 1) handleDateUpload(); if (i === 2) handleUpload('gallery'); }
      );
    } else {
      showAlert('Upload photos', 'Choose a source', [
        { text: 'Choose from library', onPress: () => handleUpload('gallery') },
        { text: 'Upload by date', onPress: () => handleDateUpload() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function handleDeletePhoto(id: string) {
    showAlert('Delete photo', 'This cannot be undone.', [
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeletingPhoto(true);
          const result = isAdmin
            ? await deletePhotos(slug, [id], params.adminPassword)
            : await deletePhotos(slug, [id], '', userMobile ?? undefined, eventUserId ?? undefined, deviceId ?? undefined);
          setDeletingPhoto(false);
          if (result.error) { showAlert('Error', result.error); return; }
          const currentIdx = lightboxIndex;
          if (lightboxSection === 'main') {
            setPhotos(prev => {
              const next = prev.filter(p => p.id !== id);
              if (next.length === 0 || currentIdx >= next.length) setLightboxVisible(false);
              else setLightboxIndex(currentIdx);
              return next;
            });
          } else {
            setOtherPhotos(prev => {
              const next = prev.filter(p => p.id !== id);
              if (next.length === 0 || currentIdx >= next.length) setLightboxVisible(false);
              else setLightboxIndex(currentIdx);
              return next;
            });
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    showAlert('Delete photos', `Delete ${ids.length} photo${ids.length > 1 ? 's' : ''}? This cannot be undone.`, [
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const result = isAdmin
            ? await deletePhotos(slug, ids, params.adminPassword)
            : await deletePhotos(slug, ids, '', userMobile ?? undefined, eventUserId ?? undefined, deviceId ?? undefined);
          if (result.error) { showAlert('Error', result.error); return; }
          exitSelectMode();
          await loadPhotos();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const JPG_LIMIT = 25;

  async function getDownloadFolder(): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    const storeKey = `downloads_folder_name_${slug}`;
    let folderName = await SecureStore.getItemAsync(storeKey);
    if (!folderName) {
      folderName = await new Promise<string | null>(resolve => {
        setFolderNameDraft(params.name);
        folderSetupResolveRef.current = resolve;
        setFolderSetupVisible(true);
      });
      if (!folderName) return null;
      await SecureStore.setItemAsync(storeKey, folderName);
    }
    const folderPath = `${RNFetchBlob.fs.dirs.DownloadDir}/${folderName}`;
    const exists = await RNFetchBlob.fs.exists(folderPath);
    if (!exists) await RNFetchBlob.fs.mkdir(folderPath);
    return folderPath;
  }

  async function ensureStorageMode(): Promise<'downloads' | 'gallery' | null> {
    return 'downloads';
  }

  async function saveFileToDownloads(filename: string, url: string, mimeType: string, folderPath: string | null, mode: 'downloads' | 'gallery', notify = false, dateTakenMs?: number): Promise<void> {
    if (Platform.OS === 'android') {
      const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`) ?? params.name;
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(url, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      const localPath = dlResult.uri.replace('file://', '');
      await MediaStore.saveToDownloads(localPath, filename, folderName, mimeType, dateTakenMs);
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    } else {
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(url, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      await Sharing.shareAsync(cacheUri, { mimeType, dialogTitle: 'Save file' });
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    }
  }

  async function saveZipToDownloads(filename: string, url: string): Promise<void> {
    if (Platform.OS === 'android') {
      const folderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`) ?? params.name;
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(url, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      const localPath = dlResult.uri.replace('file://', '');
      await MediaStore.saveToDownloads(localPath, filename, folderName, 'application/zip');
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    } else {
      const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
      const dlResult = await FileSystem.downloadAsync(url, cacheUri);
      if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
      await Sharing.shareAsync(cacheUri, { mimeType: 'application/zip', dialogTitle: 'Save ZIP' });
      await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    }
  }

  async function handleDownloadPhoto(id: string) {
    const photo = [...photos, ...otherPhotos].find(p => p.id === id);
    const mode = await ensureStorageMode();
    if (!mode) return;
    const folderPath = await getDownloadFolder();
    if (!folderPath && mode === 'downloads') return;

    showAlert('Download photo', 'Save this photo to your Downloads folder?', [
      {
        text: 'Download', onPress: async () => {
          setDownloadingPhoto(true);
          try {
            const rawName = photo?.original_filename ?? `photo_${id}.jpg`;
            const ext = rawName.split('.').pop()?.toLowerCase() ?? 'jpg';
            const filename = buildDownloadFilename(id, photo?.taken_at ?? null, ext);
            const urlRes = await getPhotoDownloadUrl(id, isAdmin ? params.adminPassword : undefined);
            if (urlRes.error) throw new Error(urlRes.error);
            const dateTakenMs = photo?.taken_at ? new Date(photo.taken_at).getTime() : undefined;
            await saveFileToDownloads(filename, urlRes.url, 'image/jpeg', folderPath, mode, true, dateTakenMs);
            const folderName = folderPath?.split('/').pop() ?? params.name;
            showAlert('Done', `Photo saved to Downloads/${folderName}.`);
          } catch (e: any) {
            showAlert('Error', e?.message ?? 'Could not download photo.');
          } finally {
            setDownloadingPhoto(false);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function saveAsJpgs(ids: string[], folderPath: string | null, mode: 'downloads' | 'gallery') {
    const CHUNK = 10;
    const allPhotos = [...photos, ...otherPhotos];
    downloadCancelledRef.current = false;
    setDownloadMode('jpg');
    setDownloadingBulk(true);
    setDownloadProgress({ current: 0, total: ids.length });
    let saved = 0;
    const failedIds: string[] = [];

    for (let chunkStart = 0; chunkStart < ids.length; chunkStart += CHUNK) {
      if (downloadCancelledRef.current) break;
      const chunkIds = ids.slice(chunkStart, chunkStart + CHUNK);

      // Fetch fresh signed URLs for this chunk right before downloading
      let urlMap: Record<string, { url?: string; displayUrl?: string; originalFilename?: string | null }> = {};
      try {
        const fetched = await getPhotoUrls(slug, chunkIds);
        if (fetched.urls) urlMap = fetched.urls;
      } catch { /* all in chunk will fail */ }

      for (let j = 0; j < chunkIds.length; j++) {
        if (downloadCancelledRef.current) break;
        const id = chunkIds[j];
        const globalIndex = chunkStart + j;
        const u = urlMap[id];
        const url = u?.url ?? u?.displayUrl ?? null;
        if (!url) {
          failedIds.push(id);
          setDownloadProgress({ current: globalIndex + 1, total: ids.length });
          continue;
        }
        try {
          const rawName = u?.originalFilename ?? `photo_${id}.jpg`;
          const ext = rawName.split('.').pop()?.toLowerCase() ?? 'jpg';
          const photo = allPhotos.find(p => p.id === id);
          const filename = buildDownloadFilename(id, photo?.taken_at ?? null, ext);
          const dateTakenMs = photo?.taken_at ? new Date(photo.taken_at).getTime() : undefined;
          await saveFileToDownloads(filename, url, 'image/jpeg', folderPath, mode, false, dateTakenMs);
          saved++;
        } catch { failedIds.push(id); }
        setDownloadProgress({ current: globalIndex + 1, total: ids.length });
      }
    }

    setDownloadingBulk(false);
    exitSelectMode();
    const parts: string[] = [];
    const folderName = folderPath?.split('/').pop() ?? params.name;
    if (saved > 0) parts.push(`${saved} JPG${saved !== 1 ? 's' : ''} saved to Downloads/${folderName}`);
    if (failedIds.length > 0) parts.push(`${failedIds.length} failed`);
    const alertButtons: AlertButton[] = [];
    if (failedIds.length > 0) {
      alertButtons.push({
        text: `Retry ${failedIds.length} failed`,
        onPress: async () => { await saveAsJpgs(failedIds, folderPath, mode); },
      });
    }
    alertButtons.push({ text: 'OK' });
    const completeMsg = parts.join(' · ');
    if (parts.length) {
      if (AppState.currentState !== 'active') {
        await showDownloadCompleteNotification(completeMsg);
      } else {
        showAlert('Download complete', completeMsg, alertButtons);
      }
    }
  }

  async function downloadAsZip(ids: string[]) {
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
    downloadCancelledRef.current = false;
    setDownloadMode('zip');
    setDownloadingBulk(true);
    setDownloadProgress({ current: 0, total: totalBatches });
    let savedBatches = 0;
    try {
      for (let i = 0; i < totalBatches; i++) {
        if (downloadCancelledRef.current) break;
        setDownloadProgress({ current: i + 1, total: totalBatches });
        const batchIds = ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const filename = totalBatches > 1
          ? `${slug}-photos-part${i + 1}of${totalBatches}.zip`
          : `${slug}-photos.zip`;
        const zipRes = await prepareZip(slug, batchIds);
        if (zipRes.error) throw new Error(zipRes.error);
        await saveZipToDownloads(filename, zipRes.zipUrl);
        savedBatches++;
      }
      setDownloadingBulk(false);
      exitSelectMode();
      const zipFolderName = await SecureStore.getItemAsync(`downloads_folder_name_${slug}`) ?? params.name;
      const msg = totalBatches > 1
        ? `${savedBatches} of ${totalBatches} ZIPs saved to Downloads/${zipFolderName}.`
        : `ZIP saved to Downloads/${zipFolderName}.`;
      if (AppState.currentState !== 'active') {
        await showDownloadCompleteNotification(msg);
      } else {
        showAlert('Download complete', msg);
      }
    } catch (e: any) {
      setDownloadingBulk(false);
      showAlert('Error', `ZIP failed: ${e?.message ?? 'unknown error'}`);
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

    const mode = await ensureStorageMode();
    if (!mode) return;
    const folderPath = await getDownloadFolder();
    if (!folderPath && mode === 'downloads') return;

    if (ids.length > JPG_LIMIT) {
      showAlert(
        `Download ${ids.length} photos as ZIP`,
        `${Math.ceil(ids.length / 50)} ZIP file${Math.ceil(ids.length / 50) > 1 ? 's' : ''} will be saved to your Downloads folder.`,
        [
          { text: 'Download', onPress: () => downloadAsZip(ids) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    showAlert(
      `Download ${ids.length} photo${ids.length > 1 ? 's' : ''}`,
      'How would you like to download?',
      [
        {
          text: 'Save as JPG',
          onPress: async () => { await saveAsJpgs(ids, folderPath, mode); },
        },
        { text: 'Save as ZIP', onPress: () => downloadAsZip(ids) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  const daysLeft = params.expiresAt ? daysUntil(params.expiresAt) : 999;
  const totalPhotos = photos.length + otherPhotos.length;
  const allSelected = totalPhotos > 0 && [...photos, ...otherPhotos].every(p => selected.has(p.id));

  const userPhotoIds = useMemo(() => {
    if (!userMobile) return new Set<string>();
    return new Set(
      [...photos, ...otherPhotos]
        .filter(p => p.uploaded_by_mobile === userMobile)
        .map(p => p.id)
    );
  }, [photos, otherPhotos, userMobile]);

  // Build flat list data + compute sticky indices
  const { listData, stickyIndices } = useMemo(() => {
    const items: ListItem[] = [];
    const sticky: number[] = [];

    items.push({ type: 'event_header', key: 'event_header' });
    if (daysLeft <= 3) items.push({ type: 'expiry_banner', key: 'expiry_banner' });
    items.push({ type: 'upload_card', key: 'upload_card' });

    if (totalPhotos > 0 && !selectMode && !deleteMode) {
      items.push({ type: 'select_photos_btn', key: 'select_photos_btn' });
    }

    if (selectMode || deleteMode) {
      items.push({ type: 'select_bar', key: 'select_bar' });
    }

    // In delete mode, only show photos uploaded by the current user (admin sees all)
    const deleteFilteredPhotos = deleteMode && !isAdmin && userMobile
      ? photos.filter(p => p.uploaded_by_mobile === userMobile)
      : photos;
    const deleteFilteredOther = deleteMode && !isAdmin && userMobile
      ? otherPhotos.filter(p => p.uploaded_by_mobile === userMobile)
      : otherPhotos;

    const mainPhotos = deleteMode ? deleteFilteredPhotos : photos;
    const otherList = deleteMode ? deleteFilteredOther : otherPhotos;

    if (mainPhotos.length > 0) {
      items.push({ type: 'section_header', section: 'main', key: 'header_main' });
      for (let i = 0; i < mainPhotos.length; i += 3) {
        items.push({ type: 'photo_row', photos: mainPhotos.slice(i, i + 3), section: 'main', startIndex: i, key: `row_main_${i}` });
      }
    }

    if (otherList.length > 0) {
      items.push({ type: 'section_header', section: 'other', key: 'header_other' });
      for (let i = 0; i < otherList.length; i += 3) {
        items.push({ type: 'photo_row', photos: otherList.slice(i, i + 3), section: 'other', startIndex: i, key: `row_other_${i}` });
      }
    }

    if (totalPhotos === 0 && !loading) {
      items.push({ type: 'empty', key: 'empty' });
    }

    return { listData: items, stickyIndices: sticky };
  }, [photos, otherPhotos, selectMode, deleteMode, daysLeft, totalPhotos, loading, userMobile, isAdmin]);

  useEffect(() => {
    listDataRef.current = listData;
    updateSectionPositions();
  }, [listData]);

  function renderSelectBar() {
    if (deleteMode) {
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
            <Pressable style={[styles.selBtn, { opacity: selected.size === 0 ? 0.4 : 1 }]} disabled={selected.size === 0} onPress={handleBulkDelete}>
              <Text style={[styles.selBtnText, { color: Colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      );
    }

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
    const isNew = newlyUploadedIds.has(photo.id);
    return (
      <TouchableOpacity
        key={photo.id}
        style={styles.thumb}
        onPress={() => {
          if (selectMode || deleteMode) {
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
        {isNew && !selectMode && !deleteMode && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>New</Text>
          </View>
        )}
        {(selectMode || deleteMode) && (
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
            <View style={styles.eventHeaderTopRow}>
              <TouchableOpacity style={styles.backBtn} onPress={() => {
                if (uploading) {
                  showAlert('Cancel upload?', 'Photos uploaded so far will be saved.', [
                    { text: 'Stop Upload', style: 'destructive', onPress: () => { uploadCancelledRef.current = true; setUploadCancelRequested(true); } },
                    { text: 'Keep Uploading', style: 'cancel' },
                  ]);
                  return;
                }
                if (bgUploading) {
                  showAlert('Cancel upload?', 'Photos uploaded so far will be saved.', [
                    { text: 'Stop Upload', style: 'destructive', onPress: () => { bgUploadCancelledRef.current = true; _bgCancelled = true; setBgCancelRequested(true); } },
                    { text: 'Keep Uploading', style: 'cancel' },
                  ]);
                  return;
                }
                clearLastEvent();
                router.replace('/(auth)/home');
              }}>
                <Text style={styles.backText}>←</Text>
              </TouchableOpacity>
              <View style={styles.adminRow}>
                {isAdmin && (
                  <>
                    <Text style={styles.adminBadge}>Admin</Text>
                    <TouchableOpacity ref={adminGearRef} style={styles.adminGearBtn} onPress={() => {
                      adminGearRef.current?.measure((_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
                        setAdminDropPos({ top: pageY + height + 4, right: Dimensions.get('window').width - pageX - width });
                        setAdminSettingsVisible(true);
                      });
                    }}>
                      <Text style={styles.adminGearIcon}>⚙️</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.notifGearBtn} onPress={async () => {
                  const notifs = await getUploadNotifications(slug);
                  setNotifications(notifs);
                  await markNotificationsRead(slug);
                  setHasUnread(false);
                  setNotificationsVisible(true);
                }}>
                  <Text style={styles.adminGearIcon}>🔔</Text>
                  {hasUnread && <View style={styles.notifDot} />}
                </TouchableOpacity>
              </View>
            </View>
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
                ? `This event closed on ${formatDate(params.expiresAt)}.\nDownload your photos before they are removed.`
                : daysLeft === 0
                ? `This event closes today (${formatDate(params.expiresAt)}).\nDownload your photos before then.`
                : `This event closes on ${formatDate(params.expiresAt)}.\nDownload your photos before then.`}
            </Text>
          </View>
        );

      case 'upload_card':
        if (bgUploading) {
          return (
            <View style={[styles.uploadOverlayCard, { marginHorizontal: 16, marginBottom: 12, width: undefined }]}>
              <View style={styles.uploadOverlayHeader}>
                <Text style={styles.uploadOverlayTitle}>
                  {bgUploadProgress.total === 0 ? 'Scanning gallery…' : 'Uploading photos'}
                </Text>
                {!bgCancelRequested ? (
                  <TouchableOpacity onPress={() => { bgUploadCancelledRef.current = true; _bgCancelled = true; setBgCancelRequested(true); }}>
                    <Text style={styles.uploadOverlayCancel}>Cancel</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.uploadOverlaySub}>Cancelling…</Text>
                )}
              </View>
              <Text style={styles.uploadOverlaySub}>
                {bgUploadProgress.total > 0
                  ? `${bgUploadProgress.current} of ${bgUploadProgress.total} uploaded`
                  : 'You can use the app while photos upload'}
              </Text>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, {
                  width: `${bgUploadProgress.total > 0 ? Math.round((bgUploadProgress.current / bgUploadProgress.total) * 100) : 0}%` as any,
                }]} />
              </View>
              <Text style={styles.uploadOverlayPct}>
                {bgUploadProgress.total > 0 ? Math.round((bgUploadProgress.current / bgUploadProgress.total) * 100) : 0}% complete — {Platform.OS === 'ios' ? 'keep the app open' : 'you can close the app'}
              </Text>
            </View>
          );
        }
        return (
          <View style={styles.uploadCard}>
            <TouchableOpacity style={[styles.uploadBtn, (selectMode || deleteMode) && { opacity: 0.5 }]} onPress={showUploadOptions} disabled={selectMode || deleteMode}>
              <Text style={styles.uploadBtnText}>Upload Photos</Text>
            </TouchableOpacity>
            <Text style={styles.uploadHint}>Max 40 photos per batch.{'\n'}{Platform.OS === 'ios' ? 'Keep the app open while uploading.' : 'You can close the app while uploading.'}</Text>
            {uploadSummary && (
              <Text style={styles.uploadSummary}>{uploadSummary}</Text>
            )}
          </View>
        );

      case 'select_photos_btn':
        return (
          <View style={styles.selectPhotosRow}>
            <TouchableOpacity style={[styles.deleteModeBtn, bgUploading && { opacity: 0.4 }]} onPress={() => { if (!bgUploading) { setDeleteMode(true); setSelectMode(false); } }}>
              <Text style={styles.deleteModeBtnText}>Delete Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.selectPhotosBtn, bgUploading && { opacity: 0.4 }]} onPress={() => { if (!bgUploading) { setSelectMode(true); setDeleteMode(false); } }}>
              <Text style={styles.selectPhotosBtnText}>Download Photos</Text>
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
              items={item.section === 'main'
                ? (deleteMode && !isAdmin && userMobile ? photos.filter(p => p.uploaded_by_mobile === userMobile) : photos)
                : (deleteMode && !isAdmin && userMobile ? otherPhotos.filter(p => p.uploaded_by_mobile === userMobile) : otherPhotos)}
              selectMode={selectMode}
              deleteMode={deleteMode}
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



      {/* Download progress overlay */}
      {downloadingBulk && (
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadOverlayCard}>
            <View style={styles.uploadOverlayHeader}>
              <Text style={styles.uploadOverlayTitle}>
                {downloadMode === 'zip' ? 'Downloading ZIP' : 'Downloading'}
              </Text>
              <TouchableOpacity onPress={() => { downloadCancelledRef.current = true; }}>
                <Text style={styles.uploadOverlayCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {downloadMode === 'zip' ? (
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
              </>
            )}
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
                saveAsJpgs(skippedPhotoList.map(p => p.id));
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

      {/* Duplicate Viewer */}
      <Modal visible={duplicateViewerVisible} animationType="slide" onRequestClose={() => setDuplicateViewerVisible(false)}>
        <SafeAreaView style={styles.container}>
          {(() => {
            const cur = duplicateResults[duplicateViewerIndex];
            const isUpgrade = cur?.status === 'upgraded';
            const existingThumbUrl = cur?.existingPhotoId
              ? photoUrls[cur.existingPhotoId]?.thumbUrl ?? photoUrls[cur.existingPhotoId]?.displayUrl
              : null;
            return (
              <>
                <View style={styles.skippedHeader}>
                  <Text style={styles.skippedTitle}>
                    {isUpgrade ? 'Upgraded' : 'Duplicate'} — {duplicateViewerIndex + 1} of {duplicateResults.length}
                  </Text>
                  <TouchableOpacity onPress={() => setDuplicateViewerVisible(false)}>
                    <Text style={styles.skippedClose}>×</Text>
                  </TouchableOpacity>
                </View>
                {cur && (
                  isUpgrade ? (
                    <View style={styles.dupBodyUpgrade}>
                      <Text style={styles.dupUpgradeLabel}>Higher quality version saved</Text>
                      <Image source={{ uri: cur.uri }} style={styles.dupUpgradePhoto} resizeMode="contain" />
                      <Text style={styles.dupUpgradeMsg}>Replaced a lower quality WhatsApp copy already in Other Photos Gallery</Text>
                    </View>
                  ) : (
                    <View style={styles.dupBody}>
                      <Text style={styles.dupSectionLabel}>Already in gallery</Text>
                      <View style={styles.dupThumbCard}>
                        {existingThumbUrl
                          ? <Image source={{ uri: existingThumbUrl }} style={styles.dupThumb} resizeMode="contain" />
                          : <View style={styles.dupThumbPlaceholder} />
                        }
                      </View>
                      <Text style={styles.dupSectionLabel}>You uploaded</Text>
                      <View style={styles.dupThumbCard}>
                        <Image source={{ uri: cur.uri }} style={styles.dupThumb} resizeMode="contain" />
                      </View>
                    </View>
                  )
                )}
                <View style={styles.skippedNav}>
                  <TouchableOpacity
                    style={[styles.skippedNavBtn, duplicateViewerIndex === 0 && { opacity: 0.3 }]}
                    onPress={() => setDuplicateViewerIndex(i => Math.max(0, i - 1))}
                    disabled={duplicateViewerIndex === 0}
                  >
                    <Text style={styles.skippedNavBtnText}>‹ Previous</Text>
                  </TouchableOpacity>
                  {duplicateViewerIndex < duplicateResults.length - 1 ? (
                    <TouchableOpacity style={styles.skippedNavBtn} onPress={() => setDuplicateViewerIndex(i => i + 1)}>
                      <Text style={styles.skippedNavBtnText}>Next ›</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.skippedNavBtn} onPress={() => setDuplicateViewerVisible(false)}>
                      <Text style={styles.skippedNavBtnText}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            );
          })()}
        </SafeAreaView>
      </Modal>

      {/* Failed Uploads Viewer */}
      {failedViewerVisible && (
        <View style={styles.uploadOverlay}>
          <View style={[styles.uploadOverlayCard, styles.failedViewerCard]}>
            <View style={styles.uploadOverlayHeader}>
              <Text style={styles.uploadOverlayTitle}>{failedResults.length} photo{failedResults.length > 1 ? 's' : ''} failed to upload</Text>
              <TouchableOpacity onPress={() => { retryNotifIdRef.current = null; setFailedViewerVisible(false); }}>
                <Text style={styles.skippedClose}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.failedGrid}>
              {failedResults.map((r, idx) => (
                <Image key={idx} source={{ uri: r.uri }} style={styles.failedThumb} resizeMode="cover" />
              ))}
            </View>
            <View style={styles.failedActions}>
              <TouchableOpacity
                style={styles.failedRetryBtn}
                onPress={() => {
                  setFailedViewerVisible(false);
                  handleUpload('gallery', failedAssetsRef.current);
                }}
              >
                <Text style={styles.failedRetryText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.failedDismissBtn}
                onPress={() => { retryNotifIdRef.current = null; setFailedViewerVisible(false); }}
              >
                <Text style={styles.failedDismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Lightbox */}
      <Modal visible={lightboxVisible} animationType="fade" onRequestClose={() => setLightboxVisible(false)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.lightbox}>
          <SafeAreaView style={styles.lightboxInner}>
            <View style={styles.lbHeader}>
              <TouchableOpacity onPress={() => setLightboxVisible(false)}>
                <Text style={styles.lbBack}>←</Text>
              </TouchableOpacity>
              <Text style={styles.lbCounter}>{lightboxIndex + 1} / {lightboxPhotos.length}</Text>
              <View style={styles.lbActions}>
                {(isAdmin || (currentPhoto != null && userPhotoIds.has(currentPhoto.id))) && (
                  <TouchableOpacity style={[styles.lbBtn, styles.lbBtnDanger]} onPress={() => currentPhoto && handleDeletePhoto(currentPhoto.id)}>
                    <Text style={[styles.lbBtnText, { color: Colors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.lbBtn} onPress={() => currentPhoto && handleDownloadPhoto(currentPhoto.id)}>
                  <Text style={styles.lbBtnText}>Download</Text>
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
        {downloadingPhoto && (
          <View style={styles.lbDownloadOverlay}>
            <ActivityIndicator color={Colors.white} size="large" />
            <Text style={styles.lbDownloadText}>Downloading…</Text>
          </View>
        )}
        {alertOverlay}
        </GestureHandlerRootView>
      </Modal>

      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          key={selectMode ? 'select' : 'normal'}
          data={listData}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          extraData={[selected, stickySection, selectBarSticky, deleteMode]}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 48 }}
          removeClippedSubviews={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                setNewlyUploadedIds(new Set());
                setUploadSummary(null);
                await loadPhotos();
                setRefreshing(false);
              }}
              tintColor={Colors.accent}
            />
          }
        />
        {(selectMode || deleteMode) && selectBarSticky && (
          <View style={styles.stickySelectBar}>
            {renderSelectBar()}
          </View>
        )}
        {(selectMode || deleteMode) && stickySection && (
          <View style={[styles.stickySectionHeader, {
            top: selectBarSticky ? (accumulatedHeights.current['select_bar'] ?? 0) : 0,
          }]}>
            <SectionHeader
              section={stickySection}
              items={stickySection === 'main' ? photos : otherPhotos}
              selectMode={selectMode}
              deleteMode={deleteMode}
              selected={selected}
              onGroupToggle={selectGroup}
            />
          </View>
        )}
      </View>

      {alertOverlay}

      {/* Folder name setup — first download only */}
      <Modal visible={folderSetupVisible} transparent animationType="fade" onRequestClose={() => {
        setFolderSetupVisible(false);
        folderSetupResolveRef.current?.(null);
      }}>
        <View style={alertStyles.overlay}>
          <View style={alertStyles.card}>
            <Text style={alertStyles.title}>Name your downloads folder</Text>
            <Text style={alertStyles.message}>Your files will be saved to Downloads / [name]. This only happens once.</Text>
            <TextInput
              value={folderNameDraft}
              onChangeText={setFolderNameDraft}
              style={styles.folderNameInput}
              autoFocus
              selectTextOnFocus
              placeholderTextColor={Colors.textMuted}
            />
            <View style={alertStyles.buttons}>
              <TouchableOpacity style={[alertStyles.btn, alertStyles.btnCancel]} onPress={() => {
                setFolderSetupVisible(false);
                folderSetupResolveRef.current?.(null);
              }}>
                <Text style={[alertStyles.btnText, alertStyles.btnCancelText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[alertStyles.btn, alertStyles.btnPrimary]} onPress={() => {
                const name = folderNameDraft.trim() || 'MomentsInFrame';
                setFolderSetupVisible(false);
                folderSetupResolveRef.current?.(name);
              }}>
                <Text style={[alertStyles.btnText, alertStyles.btnPrimaryText]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* iOS date picker modal for Upload by date */}
      {showDatePickerModal && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowDatePickerModal(false)}>
          <View style={styles.datePickerOverlay}>
            <View style={styles.datePickerCard}>
              <Text style={styles.datePickerTitle}>Select date</Text>
              <DateTimePicker
                value={datePickerDate}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={(_: any, date?: Date) => { if (date) setDatePickerDate(date); }}
                textColor={Colors.white}
                style={{ width: '100%' }}
              />
              <View style={styles.datePickerBtns}>
                <TouchableOpacity style={styles.datePickerCancelBtn} onPress={() => setShowDatePickerModal(false)}>
                  <Text style={styles.datePickerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.datePickerConfirmBtn} onPress={() => {
                  setShowDatePickerModal(false);
                  const dateStr = datePickerDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                  showAlert(
                    'Upload photos from this date',
                    `Upload all photos from your Camera folder taken on ${dateStr}?`,
                    [
                      { text: 'Upload', onPress: () => startDateUpload(datePickerDate) },
                      { text: 'Cancel', style: 'cancel' },
                    ]
                  );
                }}>
                  <Text style={styles.datePickerConfirmText}>Next</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Notifications panel */}
      <Modal visible={notificationsVisible} animationType="slide" onRequestClose={() => setNotificationsVisible(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.skippedHeader}>
            <Text style={styles.notifPanelTitle}>Upload History</Text>
            <TouchableOpacity onPress={() => setNotificationsVisible(false)}>
              <Text style={styles.skippedClose}>×</Text>
            </TouchableOpacity>
          </View>
          {notifications.length === 0 ? (
            <View style={styles.notifEmpty}>
              <Text style={styles.notifEmptyTitle}>No upload history yet.</Text>
              <Text style={styles.notifEmptySub}>Your upload results will appear here after each upload, whether you were on the screen or not.</Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={n => n.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => {
                const d = new Date(item.timestamp);
                const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
                const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
                const parts: string[] = [];
                if (item.photosAdded > 0) parts.push(`${item.photosAdded} added`);
                if (item.duplicatesSkipped > 0) parts.push(`${item.duplicatesSkipped} duplicate${item.duplicatesSkipped > 1 ? 's' : ''} skipped`);
                if (item.upgradesFound > 0) parts.push(`${item.upgradesFound} upgraded`);
                if (item.failedCount > 0) parts.push(`${item.failedCount} failed`);
                let summary: string;
                if (parts.length > 0) {
                  summary = parts.join(' · ');
                } else if (item.source === 'by_date' && (item.preSkipped ?? 0) > 0) {
                  summary = `${item.preSkipped} already uploaded, nothing new`;
                } else if (item.source === 'by_date') {
                  summary = 'No photos found for this date';
                } else {
                  summary = 'Nothing uploaded';
                }
                const hasDups = item.duplicateData.length > 0;
                const hasFailed = (item.failedCount ?? 0) > 0 && (item.failedData?.length ?? 0) > 0;
                return (
                  <View style={styles.notifCard}>
                    <View style={styles.notifCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifCardDate}>{dateStr} · {timeStr}</Text>
                        {(() => {
                          const total = (item.photosAdded ?? 0) + (item.duplicatesSkipped ?? 0) + (item.upgradesFound ?? 0) + (item.failedCount ?? 0) + (item.preSkipped ?? 0);
                          const label = item.source === 'by_date' ? 'Upload by date' : 'Manual upload';
                          return <Text style={styles.notifCardSource}>{label}{total > 0 ? ` · Total ${total} photo${total !== 1 ? 's' : ''}` : ''}</Text>;
                        })()}
                      </View>
                      <TouchableOpacity
                        style={styles.notifDeleteBtn}
                        onPress={async () => {
                          await deleteUploadNotification(slug, item.id);
                          const updated = await getUploadNotifications(slug);
                          setNotifications(updated);
                        }}
                      >
                        <Text style={styles.notifDeleteText}>×</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.notifCardSummary}>{summary}</Text>
                    <View style={styles.notifBtnRow}>
                      {hasDups && (
                        <TouchableOpacity
                          style={styles.notifViewDupsBtn}
                          onPress={() => {
                            setNotificationsVisible(false);
                            setDuplicateResults(item.duplicateData as any);
                            setDuplicateViewerIndex(0);
                            setDuplicateViewerVisible(true);
                          }}
                        >
                          <Text style={styles.notifViewDupsText}>View duplicates</Text>
                        </TouchableOpacity>
                      )}
                      {hasFailed && item.source === 'individual' && (
                        <TouchableOpacity
                          style={styles.notifViewDupsBtn}
                          onPress={() => {
                            setNotificationsVisible(false);
                            retryNotifIdRef.current = item.id;
                            setFailedResults(item.failedData as any);
                            failedAssetsRef.current = item.failedData.map(r => ({ uri: r.uri, fileName: r.filename, assetId: undefined } as any));
                            setFailedViewerVisible(true);
                          }}
                        >
                          <Text style={styles.notifViewDupsText}>View failed / Retry</Text>
                        </TouchableOpacity>
                      )}
                      {hasFailed && item.source === 'by_date' && item.uploadDate && (
                        <TouchableOpacity
                          style={styles.notifViewDupsBtn}
                          onPress={() => {
                            setNotificationsVisible(false);
                            retryNotifIdRef.current = item.id;
                            startDateUpload(new Date(item.uploadDate!));
                          }}
                        >
                          <Text style={styles.notifViewDupsText}>Retry</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Admin settings dropdown */}
      {adminSettingsVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setAdminSettingsVisible(false)}>
          <TouchableOpacity style={styles.adminDropdownBackdrop} activeOpacity={1} onPress={() => setAdminSettingsVisible(false)}>
            <View style={[styles.adminDropdown, { position: 'absolute', top: adminDropPos.top, right: adminDropPos.right }]}>
              <TouchableOpacity style={styles.adminDropdownRow} onPress={() => {
                setAdminSettingsVisible(false);
                setCpNew('');
                setCpConfirm('');
                setChangePasswordVisible(true);
              }}>
                <Text style={styles.adminDropdownText}>Change Password</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Change password modal */}
      {changePasswordVisible && (
        <Modal transparent animationType="fade" onRequestClose={() => setChangePasswordVisible(false)}>
          <View style={styles.cpOverlay}>
            <View style={styles.cpBox}>
              <Text style={styles.cpTitle}>Change Admin Password</Text>
              <View style={styles.cpRow}>
                <TextInput
                  style={styles.cpInput}
                  value={cpNew}
                  onChangeText={setCpNew}
                  placeholder="New password"
                  placeholderTextColor="#555"
                  secureTextEntry={!cpShowNew}
                  autoFocus
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.cpEye} onPress={() => setCpShowNew(!cpShowNew)}>
                  <Text>{cpShowNew ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cpRow}>
                <TextInput
                  style={styles.cpInput}
                  value={cpConfirm}
                  onChangeText={setCpConfirm}
                  placeholder="Confirm new password"
                  placeholderTextColor="#555"
                  secureTextEntry={!cpShowConfirm}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.cpEye} onPress={() => setCpShowConfirm(!cpShowConfirm)}>
                  <Text>{cpShowConfirm ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
              {cpError ? <Text style={styles.cpError}>{cpError}</Text> : null}
              <View style={styles.cpBtns}>
                <TouchableOpacity style={styles.cpBtnPrimary} onPress={submitChangePassword}>
                  <Text style={styles.cpBtnPrimaryText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cpBtnCancel} onPress={() => { setChangePasswordVisible(false); setCpError(''); }}>
                  <Text style={styles.cpBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Event header
  eventHeader: { paddingTop: 16, paddingBottom: 16, paddingHorizontal: 16 },
  eventHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backBtn: {},
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adminBadge: { fontSize: 15, fontWeight: '700', color: Colors.accent, letterSpacing: 0.5 },
  adminGearBtn: { padding: 4 },
  adminGearIcon: { fontSize: 20 },
  adminDropdownBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  adminDropdown: { backgroundColor: '#1C1C1C', borderRadius: 12, borderWidth: 0.5, borderColor: '#333', overflow: 'hidden' },
  adminDropdownRow: { paddingHorizontal: 16, paddingVertical: 14 },
  adminDropdownText: { fontSize: 14, fontWeight: '600', color: Colors.white },
  cpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  cpBox: { backgroundColor: '#1C1C1C', borderRadius: 16, padding: 24, width: '100%', borderWidth: 0.5, borderColor: '#333' },
  cpTitle: { fontSize: 15, fontWeight: '700', color: Colors.white, marginBottom: 16 },
  cpRow: { flexDirection: 'row', backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderRadius: 10, marginBottom: 12, alignItems: 'center' },
  cpInput: { flex: 1, padding: 12, fontSize: 15, color: Colors.white },
  cpEye: { padding: 12 },
  cpError: { fontSize: 13, color: '#E53935', marginBottom: 8 },
  cpBtns: { gap: 8, marginTop: 4 },
  cpBtnPrimary: { backgroundColor: Colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  cpBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  cpBtnCancel: { borderRadius: 10, padding: 14, alignItems: 'center' },
  cpBtnCancelText: { fontSize: 15, fontWeight: '700', color: Colors.textMuted },
  backText: { fontSize: 24, color: Colors.textMuted },
  eventHeaderBody: { alignItems: 'center' },
  eventName: { ...Typography.eventName, color: Colors.white, textAlign: 'center', marginBottom: 4 },
  eventMeta: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 2 },
  eventMetaSub: { fontSize: 12, color: '#666', textAlign: 'center' },

  // Expiry banner
  expiryBanner: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', backgroundColor: 'rgba(245,158,11,0.08)', paddingHorizontal: 14, paddingVertical: 10 },
  expiryText: { fontSize: 13, color: '#D97706', lineHeight: 20 },

  // Upload card
  uploadCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.cardBorder, backgroundColor: Colors.card, padding: 16, alignItems: 'center' },
  uploadSummary: { ...Typography.caption, color: '#22C55E', marginTop: 8, textAlign: 'center' },
  uploadBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, marginBottom: 10 },
  uploadBtnText: { ...Typography.buttonText, color: Colors.background },
  uploadHint: { ...Typography.caption, color: '#888', textAlign: 'center', fontWeight: '700' },

  // Select photos button
  selectPhotosRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  selectPhotosBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  selectPhotosBtnText: { ...Typography.buttonText, color: Colors.background },
  deleteModeBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.danger, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  deleteModeBtnText: { ...Typography.buttonText, color: Colors.danger },

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
  sectionTitle: { ...Typography.sectionHeading, color: Colors.white },
  sectionCount: { fontSize: 14, color: '#888' },
  sectionSub: { fontSize: 13, color: '#666' },
  sectionSelectLink: { fontSize: 13, color: Colors.accent, textDecorationLine: 'underline' },
  sectionSelectRow: { marginTop: 6, gap: 6 },
  deleteNote: { fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 2 },
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
  newBadge: { position: 'absolute', top: 5, left: 5, backgroundColor: '#22C55E', borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
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
  lbDeletingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  lbDeletingText: { fontSize: 14, fontWeight: '700', color: Colors.white },
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
  skippedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
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

  // Duplicate viewer (both photos)
  dupBody: { flex: 1, padding: 8, gap: 4 },
  dupSectionLabel: { fontSize: 12, fontWeight: '600', color: Colors.accent, textAlign: 'center' },
  dupThumbCard: { width: '100%', flex: 1, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden' },
  dupThumb: { width: '100%', height: '100%' },
  dupThumbPlaceholder: { width: '100%', height: '100%', backgroundColor: '#1a1a1a' },
  dupLabel: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: 16, paddingHorizontal: 16 },
  // Upgrade viewer (single photo)
  dupBodyUpgrade: { flex: 1, padding: 12, gap: 10 },
  dupUpgradeLabel: { fontSize: 13, fontWeight: '700', color: Colors.accent, textAlign: 'center' },
  dupUpgradePhoto: { flex: 1, width: '100%', borderRadius: 12, backgroundColor: '#111' },
  dupUpgradeMsg: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: 8 },

  folderNameInput: { backgroundColor: '#2c2c2e', color: Colors.white, fontSize: 15, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16, borderWidth: 1, borderColor: '#444' },

  // Failed viewer
  failedViewerCard: { maxHeight: '85%' },
  failedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 12 },
  failedThumb: { width: (SCREEN_WIDTH - 48 - 8) / 3, height: (SCREEN_WIDTH - 48 - 8) / 3, borderRadius: 6 },
  failedActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  failedRetryBtn: { flex: 1, backgroundColor: Colors.white, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  failedRetryText: { fontSize: 14, fontWeight: '600', color: Colors.background },
  failedDismissBtn: { flex: 1, borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  failedDismissText: { fontSize: 14, fontWeight: '500', color: Colors.textMuted },

  lbDownloadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10, justifyContent: 'center', alignItems: 'center', gap: 12 },
  lbDownloadText: { color: Colors.white, fontSize: 14, fontWeight: '500' },
  lbMeta: { fontSize: 12, color: '#555', textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  lbUploadedBy: { fontSize: 12, color: '#444', textAlign: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  lbSwipeHint: { fontSize: 10, color: '#333', textAlign: 'center', paddingBottom: 10 },

  // Notifications
  notifPanelTitle: { fontSize: 18, fontWeight: '700', color: Colors.white, flex: 1 },
  notifEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 12 },
  notifEmptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  notifEmptySub: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },
  notifGearBtn: { padding: 4, position: 'relative' },
  notifDot: { position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E53935' },
  notifCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.cardBorder, padding: 14, gap: 8 },
  notifCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  notifCardDate: { fontSize: 13, fontWeight: '600', color: Colors.white },
  notifCardSource: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  notifCardSummary: { fontSize: 13, color: '#22C55E' },
  notifDeleteBtn: { paddingLeft: 12, paddingBottom: 4 },
  notifDeleteText: { fontSize: 22, color: Colors.textMuted, lineHeight: 22 },
  notifBtnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  notifViewDupsBtn: { borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start' },
  notifViewDupsText: { fontSize: 13, fontWeight: '600', color: Colors.accent },

  // Background upload by date banner
  bgUploadBanner: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 90, paddingHorizontal: 16, paddingTop: 12 },
  bgUploadBannerInner: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 0.5, borderColor: Colors.cardBorder, padding: 16, gap: 8 },
  bgUploadBannerTitle: { fontSize: 14, fontWeight: '600', color: Colors.white },
  bgUploadBannerSub: { fontSize: 12, color: Colors.textMuted },

  // Date picker modal (iOS)
  datePickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  datePickerCard: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 20 },
  datePickerTitle: { fontSize: 16, fontWeight: '600', color: Colors.white, textAlign: 'center', marginBottom: 8 },
  datePickerBtns: { flexDirection: 'row', gap: 12, marginTop: 12 },
  datePickerCancelBtn: { flex: 1, borderWidth: 0.5, borderColor: Colors.cardBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  datePickerCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textMuted },
  datePickerConfirmBtn: { flex: 1, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  datePickerConfirmText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
