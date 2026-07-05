import { requireNativeModule } from 'expo-modules-core';

interface MediaStoreModule {
  saveToDownloads(sourcePath: string, filename: string, subfolder: string, mimeType: string, dateTakenMs?: number): Promise<string>;
}

export default requireNativeModule<MediaStoreModule>('MediaStore');
