import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { getSocket, onSocket } from '../../lib/socket';
import type { ChillItem, ChillLine, ChillState } from '../../lib/types';

type Status = 'joining' | 'live' | 'closed' | 'error';

type ChillStore = {
  code: string | null;
  status: Status;
  error: string | null;
  state: ChillState | null;
  chat: ChillLine[];
  /** serverClock − localClock, measured with pings. */
  offset: number;
};

export const useChillRoom = create<ChillStore>(() => ({ code: null, status: 'joining', error: null, state: null, chat: [], offset: 0 }));

const set = useChillRoom.setState;
const get = useChillRoom.getState;

export const serverNow = () => Date.now() + get().offset;

export const currentItem = (s: ChillState | null): ChillItem | null => (s ? (s.queue[s.index] ?? null) : null);

/** Where the song should be right now, in ms — the same answer on every phone in the room. */
export function positionOf(s: ChillState | null) {
  if (!s) return 0;
  const pos = s.playing ? s.positionMs + (serverNow() - s.anchorAt) : s.positionMs;
  const dur = currentItem(s)?.durationMs;
  return Math.max(0, dur ? Math.min(pos, dur) : pos);
}

// ---------- connection ----------

let bestRtt = Infinity;
function ping(s: Socket) {
  const t0 = Date.now();
  s.timeout(5000).emit('chill:ping', {}, (err: unknown, r: { serverNow: number }) => {
    if (err || !r) return;
    const t1 = Date.now();
    const rtt = t1 - t0;
    // Keep the measurement from the quickest round trip; it's the most accurate.
    if (rtt <= bestRtt * 1.3) {
      bestRtt = Math.min(bestRtt, rtt);
      set({ offset: r.serverNow - (t0 + t1) / 2 });
    }
  });
}

const onState = (st: ChillState & { serverNow: number }) => {
  if (st.code !== get().code) return;
  set({ state: st, status: 'live' });
};
const onChat = (p: { code: string; line: ChillLine }) => {
  if (p.code !== get().code) return;
  set((x) => ({ chat: [...x.chat, p.line].slice(-150) }));
};
const onClosed = (p: { code: string }) => {
  if (p.code === get().code) set({ status: 'closed' });
};

let unsub: (() => void) | null = null;
let pinger: ReturnType<typeof setInterval> | null = null;

export function joinChill(code: string) {
  leaveChill();
  bestRtt = Infinity;
  set({ code, status: 'joining', error: null, state: null, chat: [] });
  let joinedOn: Socket | null = null;
  const off = onSocket((s) => {
    s.off('chill:state', onState).on('chill:state', onState);
    s.off('chill:chat', onChat).on('chill:chat', onChat);
    s.off('chill:closed', onClosed).on('chill:closed', onClosed);
    // A dropped connection leaves the room on the server: join again each time it comes back.
    joinedOn?.off('connect', join);
    joinedOn = s;
    s.on('connect', join);
    if (s.connected) join();
  });
  function join() {
    const s = joinedOn;
    if (!s) return;
    const t0 = Date.now();
    s.timeout(10_000).emit('chill:join', { code }, (err: unknown, r: { ok?: boolean; error?: string; state?: ChillState; chat?: ChillLine[]; serverNow?: number }) => {
      if (get().code !== code) return;
      if (err) return set({ status: 'error', error: 'NivoTalk is waking up — try again in a moment' });
      if (!r?.ok || !r.state) return set({ status: r?.error?.includes('closed') ? 'closed' : 'error', error: r?.error ?? 'Couldn’t join' });
      const t1 = Date.now();
      if (r.serverNow) {
        bestRtt = t1 - t0;
        set({ offset: r.serverNow - (t0 + t1) / 2 });
      }
      set({ state: r.state, chat: r.chat ?? [], status: 'live' });
      ping(s);
    });
  }
  pinger = setInterval(() => {
    const s = getSocket();
    if (s?.connected) ping(s);
  }, 20_000);
  unsub = () => {
    off();
    joinedOn?.off('connect', join);
    const s = getSocket();
    s?.emit('chill:leave', { code });
    s?.off('chill:state', onState).off('chill:chat', onChat).off('chill:closed', onClosed);
  };
}

export function leaveChill() {
  unsub?.();
  unsub = null;
  if (pinger) clearInterval(pinger);
  pinger = null;
  set({ code: null, state: null, chat: [] });
}

// ---------- actions ----------

const emit = (event: string, payload: Record<string, unknown> = {}) => getSocket()?.emit(event, { code: get().code, ...payload });

export type Control = 'play' | 'pause' | 'next' | 'prev';
export const chill = {
  control(action: Control) {
    emit('chill:control', { action, expectId: currentItem(get().state)?.id });
  },
  seek(positionMs: number) {
    emit('chill:control', { action: 'seek', positionMs: Math.round(positionMs), expectId: currentItem(get().state)?.id });
  },
  jump(itemId: string) {
    emit('chill:control', { action: 'jump', itemId });
  },
  remove(itemId: string) {
    emit('chill:remove', { itemId });
  },
  shuffle() {
    emit('chill:shuffle');
  },
  say(text: string) {
    emit('chill:chat', { text });
  },
  ended(itemId: string) {
    emit('chill:ended', { itemId });
  },
  duration(itemId: string, durationMs: number) {
    emit('chill:duration', { itemId, durationMs: Math.round(durationMs) });
  },
  unplayable(itemId: string) {
    emit('chill:unplayable', { itemId });
  },
  /** Resolves to null when added, or an error message. */
  add(song: { link: string } | { trackId: number; title: string; artist: string; artwork: string | null; durationMs: number | null }) {
    return new Promise<string | null>((resolve) => {
      const s = getSocket();
      if (!s?.connected) return resolve('You’re offline — try again');
      s.timeout(20_000).emit('chill:add', { code: get().code, song }, (err: unknown, r: { ok?: boolean; error?: string }) => {
        if (err) return resolve('That took too long — try again');
        resolve(r?.ok ? null : (r?.error ?? 'Couldn’t add that song'));
      });
    });
  },
};
