import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a shell around the live site, so every web deploy updates the app without reinstalling.
// Set NIVOTALK_URL when syncing if your Render URL differs.
const LIVE_URL = process.env.NIVOTALK_URL || 'https://nivotalk01.onrender.com';

const config: CapacitorConfig = {
  appId: 'com.nivotalk.app',
  appName: 'NivoTalk',
  webDir: 'dist',
  server: {
    url: LIVE_URL,
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#F2F5FE',
  },
  plugins: {
    SplashScreen: {
      // Stays up until the app's own loader is on screen (the app calls hide), with a 60 s safety cap.
      launchShowDuration: 60000,
      launchAutoHide: true,
      backgroundColor: '#F2F5FE',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
