import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface BackgroundUploadModule {
  startService(title: string, desc: string): Promise<void>;
  updateService(title: string, desc: string, progress: number, max: number): Promise<void>;
  stopService(): Promise<void>;
  isRunning(): boolean;
}

const BackgroundUpload = requireNativeModule<BackgroundUploadModule>('BackgroundUpload');
export default BackgroundUpload;
