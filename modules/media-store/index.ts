import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface MediaStoreModule {
  saveToDownloads(sourcePath: string, filename: string, subfolder: string, mimeType: string, dateTakenMs?: number): Promise<string>;
}

const MediaStore: MediaStoreModule = Platform.OS === 'android'
  ? requireNativeModule<MediaStoreModule>('MediaStore')
  : { saveToDownloads: async () => '' };

export default MediaStore;
