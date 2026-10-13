import type { CbSide } from '../../lib/types';
import { stickerUrl } from '../../lib/stickers';

/** A golden potato chip. */
export function ChipArt({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/games/chip.webp"
      alt=""
      width={size}
      height={size}
      className={`object-contain drop-shadow-[0_2px_3px_rgba(180,120,0,0.25)] select-none ${className}`}
      draggable={false}
      aria-hidden="true"
    />
  );
}

/** A round, smiling bomb with a lit fuse. */
export function BombArt({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true">
      <path d="M24.5 9.5c1.5-3 4-4 6.2-3.2" stroke="#8a7a9e" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="31.5" cy="6" r="2.6" fill="#ffb347" />
      <circle cx="31.5" cy="6" r="1.2" fill="#fff2c4" />
      <rect x="20" y="8.5" width="7" height="5" rx="1.4" transform="rotate(28 23.5 11)" fill="#4a4266" />
      <circle cx="19" cy="23.5" r="13" fill="#3a3352" />
      <circle cx="13.6" cy="18" r="3.2" fill="#fff" opacity=".22" />
      <circle cx="15.2" cy="24" r="1.5" fill="#fff" />
      <circle cx="22.8" cy="24" r="1.5" fill="#fff" />
      <path d="M16.6 28.2c1.4 1.3 3.4 1.3 4.8 0" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export const SIDE_INFO: Record<CbSide, { name: string; mascot: string; sticker: string; hello: string }> = {
  blue: { name: 'Blue grid', mascot: 'Pepo', sticker: 'pepo-01', hello: 'pepo-05' },
  pink: { name: 'Pink grid', mascot: 'Pomi', sticker: 'pomi-01', hello: 'pomi-03' },
};

export function Mascot({ side, size = 64, className = '' }: { side: CbSide; size?: number; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-white shadow-[0_8px_20px_rgba(90,111,208,0.16)] dark:bg-surface-2 ${className}`} style={{ width: size, height: size }}>
      <img src={stickerUrl(SIDE_INFO[side].sticker)} alt="" className="object-contain" style={{ width: size * 0.82, height: size * 0.82 }} draggable={false} />
    </span>
  );
}

/** Where the decorative chips and bombs sit on the side-picker grids. */
const PREVIEW: Record<CbSide, Record<number, 'chip' | 'bomb'>> = {
  blue: { 1: 'chip', 6: 'bomb', 8: 'chip', 14: 'chip' },
  pink: { 2: 'chip', 4: 'bomb', 9: 'chip', 15: 'bomb' },
};

/** A small 4×4 board for the side picker. */
export function PreviewGrid({ side, tile = 44 }: { side: CbSide; tile?: number }) {
  return (
    <div className={`cb-${side} grid shrink-0 grid-cols-4`} style={{ gap: tile * 0.17 }} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => {
        const t = PREVIEW[side][i];
        return (
          <span key={i} className={`cb-tile ${t ? `cb-tile-${t}` : 'cb-tile-hidden'} grid place-items-center`} style={{ width: tile, height: tile }}>
            {t === 'chip' && <ChipArt size={tile * 0.62} />}
            {t === 'bomb' && <BombArt size={tile * 0.62} />}
          </span>
        );
      })}
    </div>
  );
}
