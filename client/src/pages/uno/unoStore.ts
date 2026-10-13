import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { COMMENT_MS, type GameComment } from '../../components/GameComments';
import { api } from '../../lib/api';
import { getSocket, onSocket } from '../../lib/socket';
import type { UnoCard, UnoColor, UnoState } from '../../lib/types';

type Status = 'joining' | 'live' | 'closed' | 'error';
export type Emote = { id: number; userId: number; emoji: string };

type UnoStore = {
  code: string | null;
  status: Status;
  error: string | null;
  state: UnoState | null;
  /** serverClock − localClock. */
  offset: number;
  emotes: Emote[];
  comments: GameComment[];
};

export const useUno = create<UnoStore>(() => ({ code: null, status: 'joining', error: null, state: null, offset: 0, emotes: [], comments: [] }));

const set = useUno.setState;
const get = useUno.getState;

export const serverNow = () => Date.now() + get().offset;
export const EMOTES = ['😂', '😮', '😡', '🔥', '👏', '😭', '🥶', '😈'];

// ---------- the same rules the server checks, so phones can light up legal cards ----------

const isWild = (c: UnoCard) => c.value === 'wild' || c.value === 'wild4';
const matches = (c: UnoCard, top: UnoCard, color: UnoColor) => isWild(c) || c.color === color || c.value === top.value;

export function canPlay(card: UnoCard, hand: UnoCard[], top: UnoCard | undefined, color: UnoColor) {
  if (!top || !matches(card, top, color)) return false;
  if (card.value !== 'wild4') return true;
  return !hand.some((c) => c.value !== 'wild4' && matches(c, top, color));
}

export const hasPlayable = (hand: UnoCard[], top: UnoCard | undefined, color: UnoColor) => hand.some((c) => canPlay(c, hand, top, color));

const ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 } as const;
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
export const sortHand = (hand: UnoCard[]) =>
  [...hand].sort((a, b) => ORDER[a.color] - ORDER[b.color] || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value));

// ---------- connection ----------

const onState = (st: UnoState) => {
  if (st.code !== get().code) return;
  set({ state: st, status: 'live' });
};
const onClosed = (p: { code: string; reason?: string }) => {
  if (p.code === get().code) set({ status: 'closed', error: p.reason ?? 'This table has closed' });
};
let emoteId = 0;
const onEmote = (p: { code: string; userId: number; emoji: string }) => {
  if (p.code !== get().code) return;
  const e = { id: ++emoteId, userId: p.userId, emoji: p.emoji };
  set((x) => ({ emotes: [...x.emotes, e].slice(-12) }));
  setTimeout(() => set((x) => ({ emotes: x.emotes.filter((y) => y.id !== e.id) })), 2200);
};

const onSay = (p: GameComment & { code: string }) => {
  if (p.code !== get().code) return;
  const c = { id: p.id, user: p.user, text: p.text };
  set((x) => ({ comments: [...x.comments, c].slice(-8) }));
  setTimeout(() => set((x) => ({ comments: x.comments.filter((y) => y.id !== c.id) })), COMMENT_MS);
};

let unsub: (() => void) | null = null;

export function joinUno(code: string) {
  leaveUno();
  set({ code, status: 'joining', error: null, state: null, emotes: [], comments: [] });
  let joinedOn: Socket | null = null;
  const off = onSocket((s) => {
    s.off('uno:state', onState).on('uno:state', onState);
    s.off('uno:closed', onClosed).on('uno:closed', onClosed);
    s.off('uno:emote', onEmote).on('uno:emote', onEmote);
    s.off('uno:say', onSay).on('uno:say', onSay);
    // A dropped connection stops watching on the server: join again each time it comes back.
    joinedOn?.off('connect', join);
    joinedOn = s;
    s.on('connect', join);
    if (s.connected) join();
  });
  function join() {
    const s = joinedOn;
    if (!s) return;
    const t0 = Date.now();
    s.timeout(10_000).emit('uno:join', { code }, (err: unknown, r: { ok?: boolean; error?: string; closed?: boolean; state?: UnoState }) => {
      if (get().code !== code) return;
      if (err) return set({ status: 'error', error: 'NivoTalk is waking up — try again in a moment' });
      if (!r?.ok || !r.state) return set({ status: r?.closed ? 'closed' : 'error', error: r?.error ?? 'Couldn’t open the table' });
      const t1 = Date.now();
      set({ state: r.state, status: 'live', offset: r.state.serverNow - (t0 + t1) / 2 });
    });
  }
  unsub = () => {
    off();
    joinedOn?.off('connect', join);
    const s = getSocket();
    s?.emit('uno:unwatch', { code });
    s?.off('uno:state', onState).off('uno:closed', onClosed).off('uno:emote', onEmote).off('uno:say', onSay);
  };
}

export function leaveUno() {
  unsub?.();
  unsub = null;
  set({ code: null, state: null, emotes: [], comments: [] });
}

// ---------- actions ----------

/** Sends a move; resolves to null when the server accepted it, or the reason it didn't. */
function move(event: string, payload: Record<string, unknown> = {}) {
  return new Promise<string | null>((resolve) => {
    const s = getSocket();
    if (!s?.connected) return resolve('You’re offline — reconnecting…');
    s.timeout(8000).emit(event, { code: get().code, ...payload }, (err: unknown, r: { ok?: boolean; error?: string }) => {
      if (err) return resolve('That took too long — try again');
      resolve(r?.ok ? null : (r?.error ?? 'That move isn’t allowed'));
    });
  });
}

export const uno = {
  start: () => move('uno:start'),
  play: (cardId: string, color?: UnoColor) => move('uno:play', { cardId, color }),
  draw: () => move('uno:draw'),
  pass: () => move('uno:pass'),
  callUno: () => move('uno:uno'),
  catchUno: () => move('uno:catch'),
  emote: (emoji: string) => getSocket()?.emit('uno:emote', { code: get().code, emoji }),
  say: (text: string) => getSocket()?.emit('uno:say', { code: get().code, text }),
  sit: (bet: number) => api(`/uno/${get().code}/sit`, { body: { bet } }),
  leave: () => api(`/uno/${get().code}/leave`, { body: {} }),
};
