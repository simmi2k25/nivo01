import { create } from 'zustand';
import { api } from '../lib/api';
import { onSocket } from '../lib/socket';
import type { LiveBooth, LiveChill, LiveUno } from '../lib/types';

/** Chill Rooms and booths friends have going right now (Together tab, chat "live" strips). */
type TogetherState = {
  rooms: LiveChill[];
  booths: LiveBooth[];
  games: LiveUno[];
  loaded: boolean;
  load: () => Promise<void>;
};

export const useTogether = create<TogetherState>((set) => ({
  rooms: [],
  booths: [],
  games: [],
  loaded: false,
  async load() {
    const r = await api<{ rooms: LiveChill[]; booths: LiveBooth[]; games?: LiveUno[] }>('/chill/live');
    set({ rooms: r.rooms, booths: r.booths, games: r.games ?? [], loaded: true });
  },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
const refresh = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    useTogether.getState().load().catch(() => {});
  }, 400);
};

/** Keeps the live list fresh: on (re)connect and whenever the server says something changed. */
export function startTogether(): () => void {
  const off = onSocket((s) => {
    s.off('together:changed', refresh);
    s.on('together:changed', refresh);
    s.off('connect', refresh);
    s.on('connect', refresh);
    refresh();
  });
  return () => void off();
}

export const liveRoomFor = (rooms: LiveChill[], conversationId: number) => rooms.find((r) => r.conversationId === conversationId) ?? null;
