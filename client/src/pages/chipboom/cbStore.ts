import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { COMMENT_MS, type GameComment } from '../../components/GameComments';
import { api } from '../../lib/api';
import { getSocket, onSocket } from '../../lib/socket';
import type { CbSide, CbState } from '../../lib/types';

type Status = 'joining' | 'live' | 'closed' | 'error';
export type Reaction = { id: number; userId: number; stickerId: string };

type CbStore = {
  code: string | null;
  status: Status;
  error: string | null;
  state: CbState | null;
  /** serverClock − localClock. */
  offset: number;
  reactions: Reaction[];
  comments: GameComment[];
};

export const useCb = create<CbStore>(() => ({ code: null, status: 'joining', error: null, state: null, offset: 0, reactions: [], comments: [] }));

const set = useCb.setState;
const get = useCb.getState;

export const serverNow = () => Date.now() + get().offset;
export const REACTIONS = ['pomi-01', 'pepo-01', 'chatty-01', 'dino-01', 'berri-01'];

// ---------- connection ----------

const onState = (st: CbState) => {
  if (st.code !== get().code) return;
  set({ state: st, status: 'live' });
};
const onClosed = (p: { code: string; reason?: string }) => {
  if (p.code === get().code) set({ status: 'closed', error: p.reason ?? 'This table has closed' });
};
let reactId = 0;
const onReact = (p: { code: string; userId: number; stickerId: string }) => {
  if (p.code !== get().code) return;
  const r = { id: ++reactId, userId: p.userId, stickerId: p.stickerId };
  set((x) => ({ reactions: [...x.reactions, r].slice(-10) }));
  setTimeout(() => set((x) => ({ reactions: x.reactions.filter((y) => y.id !== r.id) })), 2400);
};

const onSay = (p: GameComment & { code: string }) => {
  if (p.code !== get().code) return;
  const c = { id: p.id, user: p.user, text: p.text };
  set((x) => ({ comments: [...x.comments, c].slice(-8) }));
  setTimeout(() => set((x) => ({ comments: x.comments.filter((y) => y.id !== c.id) })), COMMENT_MS);
};

let unsub: (() => void) | null = null;

export function joinCb(code: string) {
  leaveCb();
  set({ code, status: 'joining', error: null, state: null, reactions: [], comments: [] });
  let joinedOn: Socket | null = null;
  const off = onSocket((s) => {
    s.off('cb:state', onState).on('cb:state', onState);
    s.off('cb:closed', onClosed).on('cb:closed', onClosed);
    s.off('cb:react', onReact).on('cb:react', onReact);
    s.off('cb:say', onSay).on('cb:say', onSay);
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
    s.timeout(10_000).emit('cb:join', { code }, (err: unknown, r: { ok?: boolean; error?: string; closed?: boolean; state?: CbState }) => {
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
    s?.emit('cb:unwatch', { code });
    s?.off('cb:state', onState).off('cb:closed', onClosed).off('cb:react', onReact).off('cb:say', onSay);
  };
}

export function leaveCb() {
  unsub?.();
  unsub = null;
  set({ code: null, state: null, reactions: [], comments: [] });
}

// ---------- actions ----------

/** Resolves to null when the server accepted it, or the reason it didn't. */
function move(event: string, payload: Record<string, unknown> = {}, timeout = 8000) {
  return new Promise<string | null>((resolve) => {
    const s = getSocket();
    if (!s?.connected) return resolve('You’re offline — reconnecting…');
    s.timeout(timeout).emit(event, { code: get().code, ...payload }, (err: unknown, r: { ok?: boolean; error?: string }) => {
      if (err) return resolve('That took too long — try again');
      resolve(r?.ok ? null : (r?.error ?? 'That move isn’t allowed'));
    });
  });
}

export const cb = {
  side: (side: CbSide) => move('cb:side', { side }),
  ready: () => move('cb:ready', {}, 15_000),
  unready: () => move('cb:unready', {}, 15_000),
  reveal: (index: number) => move('cb:reveal', { index }),
  /** Setup: the full set of tiles where you're hiding bombs on your friend's board. */
  place: (spots: number[]) => move('cb:place', { spots }),
  lock: (locked: boolean) => move('cb:lock', { locked }),
  react: (stickerId: string) => getSocket()?.emit('cb:react', { code: get().code, stickerId }),
  say: (text: string) => getSocket()?.emit('cb:say', { code: get().code, text }),
  leave: () => api(`/chipboom/${get().code}/leave`, { body: {} }),
  close: () => api(`/chipboom/${get().code}/close`, { body: {} }),
};
