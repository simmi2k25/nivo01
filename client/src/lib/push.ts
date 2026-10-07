import { Capacitor } from '@capacitor/core';
import { api } from './api';
import { openTarget } from './notify';

/** Phone push notifications in the Android app (Firebase Cloud Messaging) — they arrive even when the app is closed. */

let token: string | null = null;
let started = false;

// Older installs of the app don't have the push plugin; the website then skips all of this.
const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications');

/** Asks for permission (once), registers this phone and sends its token to the server. Call after sign-in. */
export async function startPush() {
  if (started || !available()) return;
  started = true;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  // Android plays the channel's sound — res/raw/notify.mp3, the same chime as in the app.
  await PushNotifications.createChannel({
    id: 'messages',
    name: 'Messages & friends',
    description: 'New messages and people adding you',
    importance: 5,
    visibility: 1,
    sound: 'notify.mp3',
    vibration: true,
    lights: true,
    lightColor: '#6f84de',
  }).catch(() => {});

  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener('registration', ({ value }) => {
    token = value;
    api('/push/token', { body: { token: value } }).catch(() => {});
  });
  await PushNotifications.addListener('registrationError', (e) => console.warn('[push] registration failed', e.error));
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const to = notification.data?.to;
    if (typeof to === 'string' && to.startsWith('/') && !to.startsWith('//')) openTarget(to);
  });

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  await PushNotifications.register();
}

/** Stops pushes to this phone for the account that's signing out. Call before logging out. */
export async function stopPush() {
  started = false;
  if (!token) return;
  const t = token;
  token = null;
  await api('/push/token', { method: 'DELETE', body: { token: t } }).catch(() => {});
}
