import { loadImage } from '../../lib/image';
import { stickerUrl } from '../../lib/stickers';

export type Layout = 'strip' | 'grid' | 'double';
export type Pattern = 'plain' | 'dots' | 'gingham' | 'hearts' | 'sparkles';
export type FilterId = 'original' | 'glow' | 'peach' | 'mono' | 'film' | 'cool' | 'pop';

export type FrameTheme = { id: string; name: string; bg: string; accent: string; ink: string };
export const FRAMES: FrameTheme[] = [
  { id: 'periwinkle', name: 'Periwinkle', bg: '#8fa1ea', accent: '#c9d3fa', ink: '#ffffff' },
  { id: 'cloud', name: 'Cloud', bg: '#ffffff', accent: '#e4e9fb', ink: '#232c5c' },
  { id: 'midnight', name: 'Midnight', bg: '#232c5c', accent: '#3a4585', ink: '#ffffff' },
  { id: 'blush', name: 'Blush', bg: '#f7c1cf', accent: '#fde3ea', ink: '#7a2f45' },
  { id: 'mint', name: 'Mint', bg: '#a8e0c8', accent: '#d6f3e6', ink: '#1f5a43' },
  { id: 'butter', name: 'Butter', bg: '#f8d977', accent: '#fdedba', ink: '#5c4510' },
  { id: 'lilac', name: 'Lilac', bg: '#c6b6f2', accent: '#e6defb', ink: '#3f2f78' },
  { id: 'peach', name: 'Peach', bg: '#f9bb98', accent: '#fde0cf', ink: '#6b3519' },
  { id: 'ink', name: 'Ink', bg: '#16171d', accent: '#2a2c36', ink: '#ffffff' },
];

export const PATTERNS: { id: Pattern; name: string }[] = [
  { id: 'plain', name: 'Plain' },
  { id: 'dots', name: 'Dots' },
  { id: 'gingham', name: 'Gingham' },
  { id: 'hearts', name: 'Hearts' },
  { id: 'sparkles', name: 'Sparkles' },
];

export const FILTERS: { id: FilterId; name: string; css: string }[] = [
  { id: 'original', name: 'Original', css: 'none' },
  { id: 'glow', name: 'Soft glow', css: 'brightness(1.08) contrast(0.9) saturate(1.12)' },
  { id: 'peach', name: 'Peach', css: 'sepia(0.22) saturate(1.25) hue-rotate(-12deg) brightness(1.05)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.12) brightness(1.04)' },
  { id: 'film', name: 'Film', css: 'sepia(0.32) contrast(1.08) brightness(0.96) saturate(0.88)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.05) hue-rotate(14deg) brightness(1.04) contrast(1.02)' },
  { id: 'pop', name: 'Pop', css: 'saturate(1.6) contrast(1.15)' },
];

export type PlacedSticker = { key: string; id: string; x: number; y: number; scale: number; rot: number };

export type StripOptions = {
  layout: Layout;
  frame: string;
  pattern: Pattern;
  filter: FilterId;
  caption: string;
  showDate: boolean;
  names: string[];
  /** The NivoTalk wordmark in the footer; removing it costs coins once per photobooth. */
  watermark: boolean;
};

/** shots[shot] = that shot's frames, one per participant (in join order). */
export type Shots = HTMLImageElement[][];

const CELL_W = 720;
const CELL_H = 540;
const PAD = 44;
const GAP = 26;
const FOOTER = 200;

type Rect = { x: number; y: number; w: number; h: number };

export function stripSize(layout: Layout, count: number) {
  if (layout === 'grid') {
    const rows = Math.ceil(count / 2);
    return { w: PAD * 2 + CELL_W * 2 + GAP, h: PAD + rows * CELL_H + (rows - 1) * GAP + FOOTER };
  }
  const single = { w: PAD * 2 + CELL_W, h: PAD + count * CELL_H + (count - 1) * GAP + FOOTER };
  return layout === 'double' ? { w: single.w * 2, h: single.h } : single;
}

function cellRects(layout: Layout, count: number): Rect[][] {
  // Returns one list of cell rects per strip (double = two identical strips side by side).
  const strip = (ox: number) =>
    Array.from({ length: count }, (_, i) => ({ x: ox + PAD, y: PAD + i * (CELL_H + GAP), w: CELL_W, h: CELL_H }));
  if (layout === 'grid') {
    return [
      Array.from({ length: count }, (_, i) => ({
        x: PAD + (i % 2) * (CELL_W + GAP),
        y: PAD + Math.floor(i / 2) * (CELL_H + GAP),
        w: CELL_W,
        h: CELL_H,
      })),
    ];
  }
  if (layout === 'double') {
    const w = stripSize('strip', count).w;
    return [strip(0), strip(w)];
  }
  return [strip(0)];
}

/** Splits one cell between the participants of a shot. */
function tiles(r: Rect, n: number): Rect[] {
  if (n <= 1) return [r];
  if (n === 2) return [0, 1].map((i) => ({ x: r.x + (i * r.w) / 2, y: r.y, w: r.w / 2, h: r.h }));
  if (n === 3) return [0, 1, 2].map((i) => ({ x: r.x + (i * r.w) / 3, y: r.y, w: r.w / 3, h: r.h }));
  return [0, 1, 2, 3].map((i) => ({ x: r.x + (i % 2) * (r.w / 2), y: r.y + Math.floor(i / 2) * (r.h / 2), w: r.w / 2, h: r.h / 2 }));
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, r: Rect) {
  const s = Math.max(r.w / img.width, r.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fill();
}

function sparklePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

function paintPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, color: string, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (pattern === 'dots') {
    for (let y = 18; y < h; y += 40) for (let x = (y / 40) % 2 ? 38 : 18; x < w; x += 40) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'gingham') {
    ctx.globalAlpha = 0.55;
    for (let x = 0; x < w; x += 56) ctx.fillRect(x, 0, 28, h);
    for (let y = 0; y < h; y += 56) ctx.fillRect(0, y, w, 28);
  } else if (pattern === 'hearts') {
    for (let y = 10; y < h; y += 70) for (let x = (y / 70) % 2 ? 50 : 15; x < w; x += 70) heartPath(ctx, x, y, 22);
  } else if (pattern === 'sparkles') {
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < (w * h) / 9000; i++) sparklePath(ctx, rnd() * w, rnd() * h, 6 + rnd() * 12);
  }
  ctx.restore();
}

const fontsReady = () =>
  Promise.all(['64px Pacifico', '600 52px Caveat', '700 26px Nunito'].map((f) => document.fonts.load(f).catch(() => {})));

const stickerCache = new Map<string, Promise<HTMLImageElement>>();
export const stickerImage = (id: string) => {
  if (!stickerCache.has(id)) stickerCache.set(id, loadImage(stickerUrl(id)));
  return stickerCache.get(id)!;
};

/**
 * Paints the whole strip. Stickers use positions relative to the canvas (0–1), with scale relative
 * to the canvas width, so the DOM preview and the export line up exactly.
 */
export async function composeStrip(canvas: HTMLCanvasElement, shots: Shots, o: StripOptions, stickers: PlacedSticker[] = []) {
  await fontsReady();
  const { w, h } = stripSize(o.layout, shots.length);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const theme = FRAMES.find((f) => f.id === o.frame) ?? FRAMES[0];

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  paintPattern(ctx, o.pattern, theme.accent, w, h);

  const filter = FILTERS.find((f) => f.id === o.filter)?.css ?? 'none';
  const groups = cellRects(o.layout, shots.length);
  for (const rects of groups) {
    rects.forEach((r, i) => {
      const frames = shots[i] ?? [];
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 18);
      ctx.clip();
      ctx.fillStyle = '#dfe5fb';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.filter = filter;
      tiles(r, frames.length).forEach((t, k) => {
        // Clip each person's photo to their own tile so a cover-scaled frame can't spill onto a neighbour.
        ctx.save();
        ctx.beginPath();
        ctx.rect(t.x, t.y, t.w, t.h);
        ctx.clip();
        drawCover(ctx, frames[k], t);
        ctx.restore();
      });
      if (frames.length > 1) {
        // thin divider between people sharing a cell
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const t of tiles(r, frames.length)) {
          if (t.x > r.x) ctx.fillRect(t.x - 1.5, t.y, 3, t.h);
          if (t.y > r.y) ctx.fillRect(t.x, t.y - 1.5, t.w, 3);
        }
      }
      ctx.filter = 'none';
      if (o.filter === 'glow') {
        const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, r.h * 0.2, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.75);
        g.addColorStop(0, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,220,235,0.28)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      if (o.filter === 'film') {
        ctx.fillStyle = 'rgba(80,50,20,0.08)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
    });

    // Footer: wordmark, caption, names and date under each strip.
    const left = rects[0].x - PAD;
    const width = o.layout === 'grid' ? w : stripSize('strip', shots.length).w;
    const cx = left + width / 2;
    const top = h - FOOTER;
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    if (o.caption.trim()) {
      ctx.font = '600 54px Caveat, cursive';
      ctx.fillText(o.caption.trim().slice(0, 40), cx, top + (o.watermark ? 70 : 100), width - 60);
      if (o.watermark) {
        ctx.font = '40px Pacifico, cursive';
        ctx.fillText('NivoTalk', cx, top + 132);
      }
    } else if (o.watermark) {
      ctx.font = '56px Pacifico, cursive';
      ctx.fillText('NivoTalk', cx, top + 96);
    }
    const meta = [o.names.join(' · '), o.showDate ? new Date().toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '']
      .filter(Boolean)
      .join('   ');
    if (meta) {
      ctx.globalAlpha = 0.82;
      ctx.font = '700 25px Nunito, sans-serif';
      ctx.fillText(meta, cx, top + 172, width - 60);
      ctx.globalAlpha = 1;
    }
  }

  for (const s of stickers) {
    const img = await stickerImage(s.id).catch(() => null);
    if (!img) continue;
    const sw = s.scale * w;
    const sh = (sw * img.height) / img.width;
    ctx.save();
    ctx.translate(s.x * w, s.y * h);
    ctx.rotate((s.rot * Math.PI) / 180);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
}
