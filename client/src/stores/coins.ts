import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuth } from './auth';

export type CoinPack = { id: string; coins: number; inr: number; tag?: string };
export type CoinHistory = { id: number; delta: number; reason: string; ref: Record<string, unknown>; createdAt: string };
export type Prices = { memorySmall: number; memoryLarge: number; wallpaper: number; groupCreate: number; groupJoin: number; watermark: number };

type CoinState = {
  coins: number;
  memorySlots: number;
  prices: Prices;
  packs: CoinPack[];
  memoryPacks: Record<'small' | 'large', { cost: number; slots: number }>;
  canBuy: boolean;
  history: CoinHistory[];
  storeOpen: boolean;
  openStore: () => void;
  closeStore: () => void;
  load: () => Promise<void>;
  setBalance: (b: { coins: number; memorySlots?: number }) => void;
};

/** Default prices so buttons can show costs before the store has loaded. */
const PRICES: Prices = { memorySmall: 3, memoryLarge: 5, wallpaper: 5, groupCreate: 5, groupJoin: 1, watermark: 2 };

export const useCoins = create<CoinState>((set, get) => ({
  coins: 0,
  memorySlots: 5,
  prices: PRICES,
  packs: [],
  memoryPacks: { small: { cost: 3, slots: 2 }, large: { cost: 5, slots: 5 } },
  canBuy: false,
  history: [],
  storeOpen: false,
  openStore: () => {
    set({ storeOpen: true });
    get().load().catch(() => {});
  },
  closeStore: () => set({ storeOpen: false }),
  async load() {
    const r = await api<Omit<CoinState, 'storeOpen' | 'openStore' | 'closeStore' | 'load' | 'setBalance'>>('/coins');
    set(r);
  },
  setBalance(b) {
    set({ coins: b.coins, ...(b.memorySlots !== undefined ? { memorySlots: b.memorySlots } : {}) });
  },
}));

// The balance arrives with your account; keep it in step when you sign in.
useAuth.subscribe((s, prev) => {
  if (s.user && s.user.id !== prev.user?.id) {
    useCoins.getState().setBalance({ coins: s.user.coins ?? 0, memorySlots: s.user.memorySlots ?? 5 });
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('nivo:need-coins', () => useCoins.getState().openStore());
}
