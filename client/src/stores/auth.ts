import { create } from 'zustand';
import { api, ApiError, WakingError } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import type { Buddy, User } from '../lib/types';

type AuthState = {
  user: User | null;
  status: 'loading' | 'ready';
  /** true while the server is unreachable / waking up from sleep */
  waking: boolean;
  init: () => Promise<void>;
  login: (identifier: string, password: string, remember: boolean) => Promise<void>;
  register: (p: { username: string; email: string; password: string; avatar: Buddy; remember: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',
  waking: false,

  async init() {
    // Keep retrying with a gentle back-off while the server wakes, then continue still signed in.
    for (let attempt = 0; ; attempt++) {
      try {
        const { user } = await api<{ user: User }>('/auth/me');
        set({ user, status: 'ready', waking: false });
        connectSocket();
        return;
      } catch (e) {
        if (e instanceof WakingError) {
          set({ waking: true });
          await sleep(Math.min(1000 + attempt * 700, 5000));
          continue;
        }
        if (e instanceof ApiError && e.status === 401) {
          set({ user: null, status: 'ready', waking: false });
          return;
        }
        set({ status: 'ready', waking: false });
        return;
      }
    }
  },

  async login(identifier, password, remember) {
    const { user } = await api<{ user: User }>('/auth/login', { body: { identifier, password, remember } });
    set({ user });
    connectSocket();
  },

  async register(p) {
    const { user } = await api<{ user: User }>('/auth/register', { body: p });
    set({ user });
    connectSocket();
  },

  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectSocket();
    set({ user: null });
    const { useChat } = await import('./chat');
    useChat.getState().reset();
  },

  setUser(u) {
    const cur = get().user;
    set({ user: cur ? { ...cur, ...u } : u });
  },
}));
