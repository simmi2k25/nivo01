import { create } from 'zustand';
import { api } from '../lib/api';
import { onSocket } from '../lib/socket';
import type { StatusArt, StatusStyle } from '../lib/statusStyles';
import type { Status, StatusGroup } from '../lib/types';

/** Text statuses: yours and your friends', grouped by person. */
type StatusState = {
  groups: StatusGroup[];
  loaded: boolean;
  composing: boolean;
  /** Whose statuses are open full-screen. */
  viewing: number | null;
  load: () => Promise<void>;
  post: (text: string, style: StatusStyle, art: StatusArt) => Promise<void>;
  remove: (id: number) => Promise<void>;
  markViewed: (s: Status) => void;
};

export const useStatus = create<StatusState>((set, get) => ({
  groups: [],
  loaded: false,
  composing: false,
  viewing: null,
  async load() {
    const r = await api<{ groups: StatusGroup[] }>('/statuses');
    set({ groups: r.groups, loaded: true });
  },
  async post(text, style, art) {
    await api('/statuses', { body: { text, style, art } });
    await get().load();
  },
  async remove(id) {
    await api(`/statuses/${id}`, { method: 'DELETE' });
    await get().load();
  },
  markViewed(s) {
    if (s.seen) return;
    // Mark it seen right away so the ring greys out; tell the server in the background.
    set((st) => ({
      groups: st.groups.map((g) => {
        if (g.user.id !== s.userId) return g;
        const statuses = g.statuses.map((x) => (x.id === s.id ? { ...x, seen: true } : x));
        return { ...g, statuses, allSeen: statuses.every((x) => x.seen) };
      }),
    }));
    api(`/statuses/${s.id}/view`, { method: 'POST' }).catch(() => {});
  },
}));

export const groupFor = (groups: StatusGroup[], userId: number) => groups.find((g) => g.user.id === userId) ?? null;

let timer: ReturnType<typeof setTimeout> | null = null;
const reload = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    useStatus.getState().load().catch(() => {});
  }, 300);
};

/** Drops statuses past their 24 hours, and anyone left with none, without waiting for a reload. */
function pruneExpired() {
  const now = Date.now();
  const { groups } = useStatus.getState();
  const next = groups
    .map((g) => {
      const statuses = g.statuses.filter((s) => new Date(s.expiresAt).getTime() > now);
      return statuses.length === g.statuses.length ? g : { ...g, statuses, allSeen: statuses.every((s) => s.seen) };
    })
    .filter((g) => g.statuses.length > 0);
  if (next.length !== groups.length || next.some((g, i) => g !== groups[i])) useStatus.setState({ groups: next });
}

export function startStatuses(): () => void {
  const off = onSocket((s) => {
    s.off('status:changed', reload).on('status:changed', reload);
    s.off('connect', reload).on('connect', reload);
    reload();
  });
  const sweep = setInterval(pruneExpired, 30_000);
  return () => {
    off();
    clearInterval(sweep);
  };
}
