import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { COMMENT_MS, type GameComment } from '../../components/GameComments';
import { api } from '../../lib/api';
import { getSocket, onSocket } from '../../lib/socket';
import type { GnState } from '../../lib/types';

type Status = 'joining' | 'live' | 'closed' | 'error';

type GnStore = {
  code: string | null;
  status: Status;
  error: string | null;
  state: GnState | null;
  /** serverClock − localClock. */
  offset: number;
  comments: GameComment[];
};

export const useGn = create<GnStore>(() => ({ code: null, status: 'joining', error: null, state: null, offset: 0, comments: [] }));

const set = useGn.setState;
const get = useGn.getState;

export const serverNow = () => Date.now() + get().offset;

// ---------- connection ----------

const onState = (st: GnState) => {
  if (st.code !== get().code) return;
  set({ state: st, status: 'live' });
};
const onClosed = (p: { code: string; reason?: string }) => {
  if (p.code === get().code) set({ status: 'closed', error: p.reason ?? 'This table has closed' });
};
const onSay = (p: GameComment & { code: string }) => {
  if (p.code !== get().code) return;
  const c = { id: p.id, user: p.user, text: p.text };
  set((x) => ({ comments: [...x.comments, c].slice(-8) }));
  setTimeout(() => set((x) => ({ comments: x.comments.filter((y) => y.id !== c.id) })), COMMENT_MS);
};

let unsub: (() => void) | null = null;

export function joinGn(code: string) {
  leaveGn();
  set({ code, status: 'joining', error: null, state: null, comments: [] });
  let joinedOn: Socket | null = null;
  const off = onSocket((s) => {
    s.off('gn:state', onState).on('gn:state', onState);
    s.off('gn:closed', onClosed).on('gn:closed', onClosed);
    s.off('gn:say', onSay).on('gn:say', onSay);
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
    s.timeout(10_000).emit('gn:join', { code }, (err: unknown, r: { ok?: boolean; error?: string; closed?: boolean; state?: GnState }) => {
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
    s?.emit('gn:unwatch', { code });
    s?.off('gn:state', onState).off('gn:closed', onClosed).off('gn:say', onSay);
  };
}

export function leaveGn() {
  unsub?.();
  unsub = null;
  set({ code: null, state: null, comments: [] });
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

export const gn = {
  sit: () => move('gn:sit'),
  secret: (value: number) => move('gn:secret', { value }),
  ready: () => move('gn:ready', {}, 15_000),
  unready: () => move('gn:unready', {}, 15_000),
  start: () => move('gn:start'),
  guess: (value: number) => move('gn:guess', { value }),
  say: (text: string) => getSocket()?.emit('gn:say', { code: get().code, text }),
  leave: () => api(`/guess/${get().code}/leave`, { body: {} }),
  close: () => api(`/guess/${get().code}/close`, { body: {} }),
};
