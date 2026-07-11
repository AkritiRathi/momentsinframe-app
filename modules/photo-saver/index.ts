import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface PhotoSaverModule {
  saveToPhotos(fileUri: string): Promise<void>;
}

// iOS only — Android uses MediaStore directly
const PhotoSaver = Platform.OS === 'ios'
  ? requireNativeModule<PhotoSaverModule>('PhotoSaver')
  : null;

export default PhotoSaver;
