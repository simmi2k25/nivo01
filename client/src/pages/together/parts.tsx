import type { CSSProperties } from 'react';
import { Avatar } from '../../components/Avatar';
import type { User } from '../../lib/types';

/** Soft gradients used when a song has no cover (and for the decorative empty cards). */
const GRADIENTS = [
  ['#a9cbff', '#5b7fe0'],
  ['#cdbcf7', '#8f7be0'],
  ['#93d7f3', '#4f9fea'],
  ['#b9c2f6', '#7c8ae0'],
  ['#c3b2f3', '#9a86e6'],
];

export function gradientFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

/** A song cover, or a pastel "sun over hills" card when there isn't one. */
export function CoverArt({ src, seed, className = '', style, rounded = 'rounded-2xl' }: { src: string | null | undefined; seed: string; className?: string; style?: CSSProperties; rounded?: string }) {
  const [a, b] = gradientFor(seed);
  return (
    <span className={`relative block overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(160deg, ${a}, ${b})`, ...style }}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} loading="lazy" />
      ) : (
        <>
          <span className="absolute top-[14%] left-1/2 aspect-square w-[52%] -translate-x-1/2 rounded-full bg-white/35" />
          <span className="absolute -bottom-[30%] left-[-20%] h-[60%] w-[140%] rounded-[50%] bg-black/10" />
        </>
      )}
    </span>
  );
}

export const fmtTime = (ms: number | null | undefined) => {
  if (ms == null || !Number.isFinite(ms)) return '–:––';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** "13 min" / "1 h 5 min" for the rest of the queue. */
export function fmtTotal(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function AvatarStack({ users, max = 3, size = 34 }: { users: User[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((u, i) => (
        <span key={u.id} className="rounded-full ring-2 ring-surface" style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar user={u} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-full bg-primary text-[12px] font-extrabold text-white ring-2 ring-surface"
          style={{ width: size, height: size, marginLeft: -size * 0.3 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Animated equaliser bars for "live" badges. */
export function LiveBars({ className = '' }: { className?: string }) {
  return (
    <span className={`flex h-6 items-end gap-[3px] ${className}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className="block h-full w-[4px] origin-bottom rounded-full bg-current" style={{ animation: `bar-dance 1s ${i * 0.15}s ease-in-out infinite` }} />
      ))}
    </span>
  );
}
