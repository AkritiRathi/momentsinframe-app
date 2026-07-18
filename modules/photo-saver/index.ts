import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface PhotoSaverModule {
  saveToPhotos(fileUri: string, dateTakenMs: number, albumName: string): Promise<string | null>;
}

// iOS only — Android uses MediaStore directly
const PhotoSaver = Platform.OS === 'ios'
  ? requireNativeModule<PhotoSaverModule>('PhotoSaver')
  : null;

export default PhotoSaver;
