const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBackgroundUpload(config) {
  return withAndroidManifest(config, config => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;
    const mainApplication = manifest.application[0];

    // Add xmlns:tools to manifest root so tools:node="remove" works
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Register the background upload foreground service
    if (!mainApplication.service) {
      mainApplication.service = [];
    }
    const serviceExists = mainApplication.service.some(
      s => s.$?.['android:name'] === 'expo.modules.backgroundupload.BackgroundUploadService'
    );
    if (!serviceExists) {
      mainApplication.service.push({
        $: {
          'android:name': 'expo.modules.backgroundupload.BackgroundUploadService',
          'android:foregroundServiceType': 'dataSync',
          'android:exported': 'false',
        },
      });
    }

    // Explicitly remove READ_MEDIA_AUDIO so Samsung never asks for audio permission
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    const audioPermExists = manifest['uses-permission'].some(
      p => p.$?.['android:name'] === 'android.permission.READ_MEDIA_AUDIO'
    );
    if (!audioPermExists) {
      manifest['uses-permission'].push({
        $: {
          'android:name': 'android.permission.READ_MEDIA_AUDIO',
          'tools:node': 'remove',
        },
      });
    }

    return config;
  });
};
