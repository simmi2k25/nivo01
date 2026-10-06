import { useEffect, useSyncExternalStore } from 'react';

/** One shared preview player so only one song plays at a time. */
type State = { url: string | null; playing: boolean; progress: number };

const audio = typeof Audio !== 'undefined' ? new Audio() : null;
let state: State = { url: null, playing: false, progress: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

if (audio) {
  audio.preload = 'none';
  audio.addEventListener('timeupdate', () => set({ progress: audio.duration ? audio.currentTime / audio.duration : 0 }));
  audio.addEventListener('ended', () => set({ playing: false, progress: 0 }));
  audio.addEventListener('pause', () => set({ playing: false }));
  audio.addEventListener('play', () => set({ playing: true }));
}

export const player = {
  toggle(url: string) {
    if (!audio) return;
    if (state.url === url && state.playing) {
      audio.pause();
      return;
    }
    if (state.url !== url) {
      audio.src = url;
      set({ url, progress: 0 });
    }
    audio.play().catch(() => set({ playing: false }));
  },
  stop() {
    if (!audio) return;
    audio.pause();
    set({ playing: false, progress: 0, url: null });
  },
};

export function usePlayer() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Stops the preview when the screen using it goes away. */
export function useStopOnLeave() {
  useEffect(() => () => player.stop(), []);
}
