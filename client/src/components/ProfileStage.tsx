import type { ReactNode } from 'react';
import { BUDDY_TINT } from '../lib/stickers';
import type { Buddy } from '../lib/types';

/**
 * Full-screen profile background (photo or soft gradient) with shading for readable white text.
 * On desktop the profile becomes a phone-shaped card over a blurred copy of the background.
 */
export function ProfileStage({ cover, buddy, children }: { cover: string | null; buddy: Buddy; children: ReactNode }) {
  const tint = BUDDY_TINT[buddy] ?? '#e4e9fb';
  const bg = cover ? `url("${cover}") center / cover no-repeat` : `linear-gradient(160deg, ${tint} 0%, #a9b6ef 48%, #5a6fd0 100%)`;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1b2148] md:grid md:place-items-center md:p-6">
      {/* desktop: blurred backdrop */}
      <div className="absolute inset-0 hidden scale-110 blur-2xl brightness-75 md:block" style={{ background: bg }} aria-hidden="true" />
      <div className="relative h-full w-full overflow-hidden md:h-[min(860px,100%)] md:w-[420px] md:rounded-[36px] md:shadow-2xl">
        <div key={cover ?? 'none'} className="absolute inset-0 animate-[fade_0.6s_ease_both,stage-zoom_1.2s_ease-out_both]" style={{ background: bg }} />
        {!cover && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="anim-float absolute top-[14%] -left-10 h-44 w-44 rounded-full bg-white/20" />
            <div className="anim-float absolute top-[38%] -right-16 h-56 w-56 rounded-full bg-white/15" style={{ animationDelay: '1s' }} />
          </div>
        )}
        {/* shading so white text stays readable on any photo */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,18,40,0.35)_0%,transparent_22%,transparent_45%,rgba(15,18,40,0.72)_100%)]" />
        <div className="relative flex h-full flex-col text-white">{children}</div>
      </div>
    </div>
  );
}
