import manifest from '../data/stickers.json';
import type { Buddy } from './types';

export type StickerPack = { id: Buddy; name: string; stickers: { id: string; w: number; h: number }[] };

export const PACKS = manifest.packs as StickerPack[];
export const BUDDIES: Buddy[] = ['berri', 'chatty', 'dino', 'pepo', 'pomi'];
export const BUDDY_NAMES: Record<Buddy, string> = {
  berri: 'Berri',
  chatty: 'Chatty',
  dino: 'Dino',
  pepo: 'Pepo',
  pomi: 'Pomi',
};
/** Each buddy's friendliest sticker doubles as their avatar. */
export const BUDDY_STICKER: Record<Buddy, string> = {
  berri: 'berri-01',
  chatty: 'chatty-01',
  dino: 'dino-01',
  pepo: 'pepo-01',
  pomi: 'pomi-01',
};
export const BUDDY_TINT: Record<Buddy, string> = {
  berri: '#ffe1de',
  chatty: '#fff1cf',
  dino: '#e3f3d4',
  pepo: '#e2ebff',
  pomi: '#ffe0ea',
};

export const stickerUrl = (id: string) => `/stickers/${id}.webp`;

const RECENT_KEY = 'nivo.recentStickers';
export function recentStickers(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}
export function rememberSticker(id: string) {
  try {
    const next = [id, ...recentStickers().filter((x) => x !== id)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}
