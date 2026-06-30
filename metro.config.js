const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Widen the transform scope to handle packages that use private class fields
// (e.g. React 19 internals and Expo modules)
config.transformer.transformIgnorePatterns = [
  'node_modules/(?!(expo|expo-router|expo-secure-store|expo-constants|expo-linking|expo-status-bar|react-native|@react-native|@react-navigation|@expo)/).*',
];

module.exports = config;
