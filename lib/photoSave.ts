// ⭐ ONE "save a photo to the phone" and ONE "share a photo" for every app
// screen (2026-11-08, the user: "7. Yes, but make sure it will not break the
// download step. Check it properly."). Used by the full-screen photo's
// Download / Share and by "select several → JPG" on the Event screen, Guest
// Uploads and Find My Photos. Memory: project_universal_lightbox.md.
//
// ⛔ PROTECTED ITEM 1 — THE iPHONE DOWNLOAD CHAIN, MOVED HERE UNCHANGED from
// the three screens (they held three identical copies; the Event screen's
// saveFileToDownloads is the master). Do not restructure it:
//   iPhone : download to the cache → PhotoSaver.saveToPhotos(file, 0, event)
//            (0 ALWAYS — a date makes PhotoSaver re-encode the JPEG,
//            2026-10-26) → if PhotoSaver is missing, MediaLibrary → delete
//            the cache file. The one-time "allow Full Access" note on limited
//            access is one of the two plain Alert.alert calls kept on purpose
//            (protected item 8) — it moved here with the chain.
//   Android: download to the cache → MediaStore.saveToDownloads(file, name,
//            folder, 'image/jpeg', REAL date) → delete the cache file. Folder
//            = the event's name, remembered per event in SecureStore.
// The file is always the date-stamped one from native/photos/[id]/download.
//
// ⛔ The NAME comes from the server with each photo (download_name — the ONE
// naming function, onealbum-trial src/lib/download-filename.ts). No name →
// the photo FAILS (never a made-up name — the user, 2026-11-08), so it is
// counted as failed and can be retried.

import { Platform, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../constants/config';

const MediaStore = Platform.OS === 'android' ? require('media-store').default : null;
let PhotoSaver: { saveToPhotos: (fileUri: string, dateTakenMs: number, albumName: string) => Promise<string | null> } | null = null;
try { PhotoSaver = require('photo-saver').default; } catch {}

/** Thrown when a photo arrived without its download name. Counts as failed (retryable). */
export const NO_NAME_MESSAGE = "This photo couldn't be downloaded. Please try again.";

export type SavePhotoArgs = {
  photoId: string;
  /** download_name from the server's photo list. */
  fileName: string | null | undefined;
  eventSlug: string;
  /** Album name (iPhone) and default folder name (Android). */
  eventName: string;
  /** The caller's number, sent as adminPhone like every download did. */
  idPhone?: string | null;
  /** The photo's date (ms) — Android writes it as the gallery's date taken. */
  dateTakenMs?: number;
};

function downloadUrl(photoId: string, idPhone?: string | null): string {
  const adminParam = idPhone ? `?adminPhone=${encodeURIComponent(idPhone)}` : '';
  return `${API_BASE_URL}/api/native/photos/${photoId}/download${adminParam}`;
}

/** The Android folder name for this event: the remembered one, else the event name (remembered from now on). */
export async function androidFolderName(eventSlug: string, eventName: string): Promise<string> {
  const storeKey = `downloads_folder_name_${eventSlug}`;
  let folderName = await SecureStore.getItemAsync(storeKey);
  if (!folderName) {
    folderName = eventName;
    await SecureStore.setItemAsync(storeKey, folderName);
  }
  return folderName;
}

/** Saves one photo to the phone. Throws on any failure ('HTTP 404' = the photo is gone). */
export async function savePhotoToPhone(a: SavePhotoArgs): Promise<void> {
  if (!a.fileName) throw new Error(NO_NAME_MESSAGE);
  const filename = a.fileName;
  const url = downloadUrl(a.photoId, a.idPhone);
  if (Platform.OS === 'android') {
    const folderName = await androidFolderName(a.eventSlug, a.eventName);
    const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
    const dlResult = await FileSystem.downloadAsync(url, cacheUri);
    if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
    const localPath = dlResult.uri.replace('file://', '');
    // ⛔ Android: the photo's REAL date (2026-10-26, "all screens the same") —
    // it only labels the gallery entry; the file is copied byte-for-byte.
    await MediaStore.saveToDownloads(localPath, filename, folderName, 'image/jpeg', a.dateTakenMs);
    await FileSystem.deleteAsync(cacheUri, { idempotent: true });
  } else {
    // iOS: save to Photos using the resource-based API to preserve EXIF.
    const cacheUri = `${FileSystem.cacheDirectory}${filename}`;
    const dlResult = await FileSystem.downloadAsync(url, cacheUri);
    if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
    if (PhotoSaver) {
      // ⛔ iPhone: ALWAYS 0 (2026-10-26, the user's yes — "all screens the same").
      // A non-zero date makes PhotoSaver rebuild the JPEG to write the date in,
      // which RE-ENCODES it (measured: 7.6 MB → 5.6 MB). The file already
      // carries its date — camera EXIF, or the server's stamp on Other Photos.
      const result = await PhotoSaver.saveToPhotos(cacheUri, 0, a.eventName);
      if (result === 'limited_access') {
        const alreadyShown = await SecureStore.getItemAsync('mif_limited_access_shown');
        if (!alreadyShown) {
          await SecureStore.setItemAsync('mif_limited_access_shown', '1');
          Alert.alert(
            'Photo Saved',
            'To organise photos into your event album, allow Full Access in Settings → Privacy & Security → Photos → MomentsInFrame.',
            [{ text: 'OK' }]
          );
        }
      }
    } else {
      await MediaLibrary.saveToLibraryAsync(cacheUri);
    }
    await FileSystem.deleteAsync(cacheUri, { idempotent: true });
  }
}

/**
 * Shares one photo — always the date-stamped file (2026-11-08: the Event screen
 * used to share the plain stored file). `stillOpen` is asked after the fetch:
 * if the full-screen photo was closed meanwhile, the share is abandoned.
 */
export async function sharePhoto(a: { photoId: string; fileName: string | null | undefined; idPhone?: string | null; stillOpen: () => boolean }): Promise<void> {
  if (!a.fileName) throw new Error("This photo couldn't be shared. Please try again.");
  const cacheUri = `${FileSystem.cacheDirectory}${a.fileName}`;
  const dlResult = await FileSystem.downloadAsync(downloadUrl(a.photoId, a.idPhone), cacheUri);
  if (dlResult.status !== 200) throw new Error(`HTTP ${dlResult.status}`);
  if (!a.stillOpen()) {
    await FileSystem.deleteAsync(cacheUri, { idempotent: true });
    return;
  }
  await Sharing.shareAsync(cacheUri, { mimeType: 'image/jpeg', dialogTitle: 'Share photo' });
  await FileSystem.deleteAsync(cacheUri, { idempotent: true });
}
