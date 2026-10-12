import { memo, useId, type CSSProperties } from 'react';
import { stickerUrl } from '../../lib/stickers';
import type { UnoCard, UnoColor, UnoValue } from '../../lib/types';

/**
 * The NivoTalk card deck, drawn on a 100×150 grid: soft pastel cards starring Pomi (rose), Pepo (sky),
 * Chatty (butter) and Dino (mint), with Berri on the wild cards.
 */

type Theme = { bg: string; ink: string; buddy: string };
export const UNO_THEME: Record<UnoColor, Theme> = {
  red: { bg: '#fdd7df', ink: '#a8304b', buddy: 'pomi-01' },
  blue: { bg: '#cfe2f8', ink: '#2a5d9a', buddy: 'pepo-01' },
  yellow: { bg: '#fde8b5', ink: '#8a6200', buddy: 'chatty-01' },
  green: { bg: '#cfe9d9', ink: '#2e7550', buddy: 'dino-01' },
};
const WILD_INK = '#3d3a6b';
const PASTEL: Record<UnoColor, string> = { red: '#fdd7df', blue: '#cfe2f8', yellow: '#fde8b5', green: '#cfe9d9' };

/** Brighter version of each card color, for glows, color picks and confetti on the dark table. */
export const UNO_HEX: Record<UnoColor, string> = { red: '#ef7d9a', yellow: '#f5bf3c', green: '#5cbc86', blue: '#5f95e6' };

const FONT = 'Fredoka, Nunito, system-ui, sans-serif';
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

type Size = { w?: number; className?: string; style?: CSSProperties };

export const UnoCardFace = memo(function UnoCardFace({ card, w = 72, className = '', style }: { card: Pick<UnoCard, 'color' | 'value'> } & Size) {
  const uid = cleanId(useId());
  const wild = card.color === 'wild';
  const theme = wild ? null : UNO_THEME[card.color as UnoColor];
  const ink = theme?.ink ?? WILD_INK;
  const buddy = theme?.buddy ?? 'berri-01';
  return (
    <svg viewBox="0 0 100 150" width={w} height={w * 1.5} className={`block select-none ${className}`} style={style} aria-label={label(card)} role="img">
      <defs>
        <clipPath id={`card-${uid}`}>
          <rect x="2" y="2" width="96" height="146" rx="9" />
        </clipPath>
      </defs>
      <rect width="100" height="150" rx="11" fill="#fff" />
      <rect x="0.5" y="0.5" width="99" height="149" rx="10.5" fill="none" stroke="#00000014" />
      {wild ? (
        <g clipPath={`url(#card-${uid})`}>
          <rect x="0" y="0" width="50" height="75" fill={PASTEL.red} />
          <rect x="50" y="0" width="50" height="75" fill={PASTEL.blue} />
          <rect x="0" y="75" width="50" height="75" fill={PASTEL.yellow} />
          <rect x="50" y="75" width="50" height="75" fill={PASTEL.green} />
        </g>
      ) : (
        <rect x="2" y="2" width="96" height="146" rx="9" fill={theme!.bg} />
      )}

      {/* white window with the symbol on top and the buddy underneath */}
      <rect x="11" y="16" width="78" height="118" rx="36" fill="#fff" />
      <g transform="translate(50 49)">
        <Center value={card.value} ink={ink} />
      </g>
      <image href={stickerUrl(buddy)} x="25" y="72" width="50" height="50" preserveAspectRatio="xMidYMid meet" />

      <g transform="translate(9 11)">
        <Corner value={card.value} ink={ink} />
      </g>
      <g transform="rotate(180 50 75) translate(9 11)">
        <Corner value={card.value} ink={ink} />
      </g>
    </svg>
  );
});

/** Card back: pastel corners with the whole crew and the NivoTalk wordmark. */
export const UnoCardBack = memo(function UnoCardBack({ w = 72, className = '', style }: Size) {
  const uid = cleanId(useId());
  const tiny = w < 30;
  return (
    <svg viewBox="0 0 100 150" width={w} height={w * 1.5} className={`block select-none ${className}`} style={style} aria-hidden="true">
      <defs>
        <clipPath id={`back-${uid}`}>
          <rect x="2" y="2" width="96" height="146" rx="9" />
        </clipPath>
        <filter id={`pill-${uid}`} x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#8a7ab0" floodOpacity="0.25" />
        </filter>
      </defs>
      <rect width="100" height="150" rx="11" fill="#fff" />
      <rect x="0.5" y="0.5" width="99" height="149" rx="10.5" fill="none" stroke="#00000014" />
      <g clipPath={`url(#back-${uid})`}>
        <rect x="0" y="0" width="100" height="150" fill="#faf3f6" />
        <circle cx="2" cy="2" r="48" fill={PASTEL.red} />
        <circle cx="98" cy="2" r="48" fill={PASTEL.blue} />
        <circle cx="2" cy="148" r="48" fill={PASTEL.yellow} />
        <circle cx="98" cy="148" r="48" fill={PASTEL.green} />
      </g>
      {!tiny && (
        <>
          <image href={stickerUrl('pomi-01')} x="6" y="6" width="28" height="28" />
          <image href={stickerUrl('pepo-01')} x="66" y="6" width="28" height="28" />
          <image href={stickerUrl('chatty-01')} x="5" y="116" width="27" height="27" />
          <image href={stickerUrl('berri-01')} x="37" y="117" width="26" height="26" />
          <image href={stickerUrl('dino-01')} x="68" y="114" width="28" height="28" />
        </>
      )}
      <g transform="rotate(-12 50 75)">
        <rect x="9" y="61" width="82" height="28" rx="14" fill="#fff" filter={tiny ? undefined : `url(#pill-${uid})`} />
        {!tiny && (
          <text x="50" y="76" textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="700" fontSize="17" letterSpacing="-0.3">
            <tspan fill="#a8304b">Nivo</tspan>
            <tspan fill="#2a5d9a">Talk</tspan>
          </text>
        )}
      </g>
    </svg>
  );
});

/** The big mark at the top of the white window. */
function Center({ value, ink }: { value: UnoValue; ink: string }) {
  if (/^[0-9]$/.test(value) || value === 'draw2') {
    return (
      <text textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="700" fontSize={value === 'draw2' ? 30 : 38} fill={ink}>
        {value === 'draw2' ? '+2' : value}
      </text>
    );
  }
  switch (value) {
    case 'skip':
      return <SkipMark r={13} ink={ink} width={4.5} />;
    case 'reverse':
      return <ReverseMark s={1} ink={ink} width={4} />;
    case 'wild':
      return <ColorWheel r={13} />;
    case 'wild4':
      return (
        <>
          <ColorWheel r={15} />
          <text textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="700" fontSize="15" fill={WILD_INK} stroke="#fff" strokeWidth="3" paintOrder="stroke">
            +4
          </text>
        </>
      );
  }
}

/** Small mark in the corners. */
function Corner({ value, ink }: { value: UnoValue; ink: string }) {
  const text = (t: string) => (
    <text textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="700" fontSize="11" fill={ink}>
      {t}
    </text>
  );
  if (/^[0-9]$/.test(value)) return text(value);
  switch (value) {
    case 'skip':
      return <SkipMark r={4} ink={ink} width={1.6} />;
    case 'reverse':
      return <ReverseMark s={0.33} ink={ink} width={5} />;
    case 'draw2':
      return text('+2');
    case 'wild':
      return text('W');
    case 'wild4':
      return text('+4');
  }
}

function SkipMark({ r, ink, width }: { r: number; ink: string; width: number }) {
  const d = r * 0.7;
  return (
    <g stroke={ink} strokeWidth={width} strokeLinecap="round" fill="none">
      <circle r={r} />
      <line x1={-d} y1={d} x2={d} y2={-d} />
    </g>
  );
}

/** Two arrows passing each other (⇄). */
function ReverseMark({ s, ink, width }: { s: number; ink: string; width: number }) {
  return (
    <g transform={`scale(${s})`} stroke={ink} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M-13 -5 H12 M5 -12 L12 -5 L5 2" />
      <path d="M13 6 H-12 M-5 -1 L-12 6 L-5 13" />
    </g>
  );
}

function ColorWheel({ r }: { r: number }) {
  return (
    <g>
      <circle r={r + 2} fill="#fff" stroke="#e6e0ee" strokeWidth="1" />
      <path d={`M0 0 L0 ${-r} A${r} ${r} 0 0 0 ${-r} 0 Z`} fill={PASTEL.red} />
      <path d={`M0 0 L${r} 0 A${r} ${r} 0 0 0 0 ${-r} Z`} fill={PASTEL.blue} />
      <path d={`M0 0 L${-r} 0 A${r} ${r} 0 0 0 0 ${r} Z`} fill={PASTEL.yellow} />
      <path d={`M0 0 L0 ${r} A${r} ${r} 0 0 0 ${r} 0 Z`} fill={PASTEL.green} />
    </g>
  );
}

const VALUE_LABEL: Partial<Record<UnoValue, string>> = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };

export function label(card: Pick<UnoCard, 'color' | 'value'>) {
  const v = VALUE_LABEL[card.value] ?? card.value;
  return card.color === 'wild' ? v : `${card.color[0].toUpperCase()}${card.color.slice(1)} ${v}`;
}
