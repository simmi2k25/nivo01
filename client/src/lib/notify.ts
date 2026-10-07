import { create } from 'zustand';
import { getPref, setPref } from './prefs';

/** An in-app pop-up: who it's from, what they said, and where tapping it goes. */
export type Popup = {
  id: number;
  title: string;
  body: string;
  to: string;
  user?: { avatar: string; avatarUrl: string | null; displayName: string };
  /** Same tag replaces the older pop-up (e.g. a burst of messages in one chat). */
  tag: string;
};

export const usePopups = create<{ list: Popup[] }>(() => ({ list: [] }));

const POPUP_MS = 5000;
const SOUND_GAP_MS = 1500;
let n = 0;

export function dismissPopup(id: number) {
  usePopups.setState((s) => ({ list: s.list.filter((p) => p.id !== id) }));
}

function showPopup(p: Omit<Popup, 'id'>) {
  const id = ++n;
  // Older timers for replaced pop-ups just find nothing to remove.
  usePopups.setState((s) => ({ list: [...s.list.filter((x) => x.tag !== p.tag).slice(-2), { ...p, id }] }));
  setTimeout(() => dismissPopup(id), POPUP_MS);
}

// ---------- preferences ----------

export const notifyPrefs = {
  sound: () => getPref('notify.sound', 'on') === 'on',
  popups: () => getPref('notify.popups', 'on') === 'on',
  setSound: (on: boolean) => setPref('notify.sound', on ? 'on' : 'off'),
  setPopups: (on: boolean) => setPref('notify.popups', on ? 'on' : 'off'),
};

// ---------- sound ----------

const sound = typeof Audio !== 'undefined' ? new Audio('/sounds/notify.mp3') : null;
if (sound) {
  sound.preload = 'auto';
  sound.volume = 0.7;
}
let lastSound = 0;

export function playNotifySound(force = false) {
  if (!sound || (!force && !notifyPrefs.sound())) return;
  const now = Date.now();
  if (!force && now - lastSound < SOUND_GAP_MS) return; // a burst of messages chimes once
  lastSound = now;
  sound.currentTime = 0;
  sound.play().catch(() => {}); // browsers block audio until the user has tapped the page once
}

// ---------- system notifications (when the tab is in the background) ----------

export const systemNotifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const systemNotifyAllowed = () => systemNotifySupported() && Notification.permission === 'granted';

/** Must be called from a tap/click — browsers ignore permission prompts otherwise. */
export async function requestSystemNotify() {
  if (!systemNotifySupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

async function showSystem(p: Omit<Popup, 'id'>) {
  const options: NotificationOptions = {
    body: p.body,
    tag: p.tag,
    icon: p.user?.avatarUrl ?? '/brand/badge-256.png',
    badge: '/icons/favicon-64.png',
    data: { to: p.to },
  };
  try {
    // Android Chrome only allows notifications through the service worker.
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) return await reg.showNotification(p.title, options);
    const note = new Notification(p.title, options);
    note.onclick = () => {
      window.focus();
      openTarget(p.to);
      note.close();
    };
  } catch {
    /* ignore */
  }
}

// ---------- routing taps back into the app ----------

let navigateFn: ((to: string) => void) | null = null;
export function setNotifyNavigator(fn: ((to: string) => void) | null) {
  navigateFn = fn;
}
export function openTarget(to: string) {
  if (navigateFn) navigateFn(to);
  else window.location.assign(to);
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // The service worker forwards notification taps to an already-open tab.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'notify:open' && typeof e.data.to === 'string') openTarget(e.data.to);
  });
}

// ---------- entry point ----------

/**
 * Chimes and shows a pop-up in the app, or a system notification while a browser tab is in the background.
 * In the Android app, a backgrounded app stays quiet here — the server sends a phone push instead.
 */
export function notify(p: Omit<Popup, 'id'>) {
  if (document.visibilityState === 'visible') {
    playNotifySound();
    if (notifyPrefs.popups()) showPopup(p);
  } else if (systemNotifyAllowed()) {
    playNotifySound();
    void showSystem(p);
  }
}
