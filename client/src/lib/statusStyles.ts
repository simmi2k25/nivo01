/** Looks a text status can have. Kept in step with STATUS_BGS / STATUS_FONTS in server/src/routes/statuses.ts. */

export const STATUS_BGS = {
  periwinkle: { bg: 'linear-gradient(160deg, #a9b8ff, #6f84de 60%, #5a6fd0)', ink: '#fff' },
  blush: { bg: 'linear-gradient(160deg, #ffd6e4, #f59ab8 65%, #e9849f)', ink: '#fff' },
  mint: { bg: 'linear-gradient(160deg, #d8f7ea, #8fdcc0 60%, #4fb69a)', ink: '#123d33' },
  sunset: { bg: 'linear-gradient(160deg, #ffe1a8, #ffa48a 55%, #e9729a)', ink: '#fff' },
  lilac: { bg: 'linear-gradient(160deg, #eadcff, #c1a7f3 60%, #a08ae0)', ink: '#fff' },
  ocean: { bg: 'linear-gradient(160deg, #a8e6ff, #5bb3ea 55%, #3b6fd6)', ink: '#fff' },
  peach: { bg: 'linear-gradient(160deg, #fff4e3, #ffd9b8 60%, #ffbe98)', ink: '#5c3317' },
  night: { bg: 'radial-gradient(120% 80% at 50% 0%, #3a4687, #1b2148 70%)', ink: '#f3f0ff' },
  berry: { bg: 'linear-gradient(160deg, #ff9fc4, #c95cc9 55%, #7b4fd6)', ink: '#fff' },
  sky: { bg: 'linear-gradient(180deg, #e8f3ff, #cfe3ff 60%, #b9d3ff)', ink: '#24356e' },
} as const;

export type StatusBg = keyof typeof STATUS_BGS;

export const STATUS_FONTS = {
  display: { label: 'Bubbly', family: "'Fredoka', 'Nunito', system-ui, sans-serif", weight: 600 },
  script: { label: 'Script', family: "'Pacifico', cursive", weight: 400 },
  hand: { label: 'Handwritten', family: "'Caveat', cursive", weight: 700 },
  body: { label: 'Clean', family: "'Nunito', system-ui, sans-serif", weight: 800 },
} as const;

export type StatusFont = keyof typeof STATUS_FONTS;
export type StatusSize = 's' | 'm' | 'l';
export type StatusStyle = { bg: StatusBg; font: StatusFont; size: StatusSize };

export const DEFAULT_STYLE: StatusStyle = { bg: 'periwinkle', font: 'display', size: 'm' };

/** Font size in px, shrinking a little for long messages so they still fit. */
export function statusFontSize(style: StatusStyle, text: string) {
  const base = { s: 24, m: 32, l: 42 }[style.size] * (style.font === 'hand' ? 1.25 : 1);
  const len = text.length;
  const shrink = len > 200 ? 0.62 : len > 120 ? 0.75 : len > 60 ? 0.88 : 1;
  return Math.round(base * shrink);
}

/** Inline styles for a status card of any size. */
export function statusLook(style: Partial<StatusStyle> | undefined) {
  const s = { ...DEFAULT_STYLE, ...style };
  const bg = STATUS_BGS[s.bg] ?? STATUS_BGS.periwinkle;
  const font = STATUS_FONTS[s.font] ?? STATUS_FONTS.display;
  return { style: s, background: bg.bg, color: bg.ink, fontFamily: font.family, fontWeight: font.weight };
}

// ---------- pen & stickers ----------

/** One pen stroke: colour, width in px, and points as a flat [x, y, x, y, …] list of 0–1 fractions. */
export type StatusStroke = { c: string; w: number; p: number[] };
/** A placed sticker: centre (0–1), width as a fraction of the screen width, rotation in degrees. */
export type PlacedSticker = { id: string; x: number; y: number; s: number; r: number };
export type StatusArt = { strokes: StatusStroke[]; stickers: PlacedSticker[] };

export const EMPTY_ART: StatusArt = { strokes: [], stickers: [] };
export const PEN_COLORS = ['#ffffff', '#232c5c', '#ff5c8a', '#ffb547', '#ffe45c', '#4fd18b', '#4fb3ff', '#a078ff'];
export const PEN_WIDTHS = [4, 9, 18];
/** Matches the server's limit on how detailed a drawing can be. */
export const MAX_POINTS = 12_000;

export const artPoints = (art: StatusArt) => art.strokes.reduce((n, s) => n + s.p.length, 0);
