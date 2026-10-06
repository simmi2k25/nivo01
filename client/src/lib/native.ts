import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

/** The native splash (the logo) stays until the app's own loader is on screen. */
export async function hideNativeSplash() {
  if (!isNative()) return;
  const { SplashScreen } = await import('@capacitor/splash-screen');
  await SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});
}

/** The deployed site (set VITE_PUBLIC_URL at build time if your Render URL differs). */
export const LIVE_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://nivotalk01.onrender.com';

export function publicOrigin() {
  // The Android app normally loads the live site itself; only a bundled copy (capacitor://localhost or
  // https://localhost) needs the live address for links and QR codes.
  const local = window.location.hostname === 'localhost' && isNative();
  return local ? LIVE_URL : window.location.origin;
}
