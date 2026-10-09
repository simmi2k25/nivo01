import { create } from 'zustand';
import { api } from '../lib/api';
import { notify } from '../lib/notify';
import { onSocket } from '../lib/socket';
import type { Announcement } from '../lib/types';

const SEEN_KEY = 'nivo:news-seen';
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

/** Announcements from the official NivoTalk account. */
type NewsState = {
  list: Announcement[];
  loaded: boolean;
  /** Newest announcement id this device has seen. */
  seenId: number;
  open: boolean;
  load: () => Promise<void>;
  show: () => void;
  hide: () => void;
  markSeen: () => void;
};

export const useNews = create<NewsState>((set, get) => ({
  list: [],
  loaded: false,
  seenId: readSeen(),
  open: false,
  async load() {
    const r = await api<{ announcements: Announcement[] }>('/announcements');
    set({ list: r.announcements, loaded: true });
  },
  show() {
    set({ open: true });
    get().markSeen();
  },
  hide: () => set({ open: false }),
  markSeen() {
    const top = get().list[0]?.id ?? 0;
    if (top <= get().seenId) return;
    set({ seenId: top });
    try {
      localStorage.setItem(SEEN_KEY, String(top));
    } catch {
      /* private mode */
    }
  },
}));

export const unseenNews = (s: NewsState) => s.list.filter((a) => a.id > s.seenId);

const onNew = (a: Announcement) => {
  useNews.setState((s) => ({ list: [a, ...s.list.filter((x) => x.id !== a.id)] }));
  if (useNews.getState().open) return useNews.getState().markSeen();
  notify({
    title: a.title || 'NivoTalk',
    body: a.body,
    to: '/chats?news=1',
    tag: `announcement:${a.id}`,
    user: a.author ? { avatar: a.author.avatar, avatarUrl: a.author.avatarUrl, displayName: a.author.displayName } : undefined,
  });
};
const onDeleted = ({ id }: { id: number }) => useNews.setState((s) => ({ list: s.list.filter((a) => a.id !== id) }));
const reload = () => useNews.getState().load().catch(() => {});

export function startNews(): () => void {
  const off = onSocket((s) => {
    s.off('announcement:new', onNew).on('announcement:new', onNew);
    s.off('announcement:deleted', onDeleted).on('announcement:deleted', onDeleted);
    s.off('connect', reload).on('connect', reload);
    reload();
  });
  return () => void off();
}
