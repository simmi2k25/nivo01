import { stickerUrl } from '../lib/stickers';

/** Animated photobooth: the booth flashes and prints a strip, Dino snaps photos, plant and curtain sway. */
export function BoothIllustration({ className = '' }: { className?: string }) {
  return (
    <div className={`relative mx-auto aspect-[4/3] h-full max-w-full ${className}`}>
      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="bi-body" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#c9d3fa" />
            <stop offset="1" stopColor="#9fb0ef" />
          </linearGradient>
          <linearGradient id="bi-side" x1="0" x2="1">
            <stop offset="0" stopColor="#8a9de6" />
            <stop offset="1" stopColor="#a9b8f2" />
          </linearGradient>
          <radialGradient id="bi-glow">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="bi-slot">
            <rect x="120" y="226" width="60" height="60" />
          </clipPath>
        </defs>

        {/* soft floor + blobs */}
        <ellipse cx="200" cy="276" rx="170" ry="16" fill="var(--primary-soft)" />
        <circle cx="70" cy="120" r="56" fill="var(--primary-soft)" opacity="0.7" />
        <circle cx="330" cy="150" r="64" fill="var(--primary-soft)" opacity="0.7" />

        {/* sparkles */}
        <g fill="var(--primary)">
          <path className="anim-twinkle" style={{ transformOrigin: '52px 60px' }} d="M52 48l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
          <path className="anim-twinkle delay-3" style={{ transformOrigin: '344px 70px', animationDelay: '0.8s' }} d="M344 62l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
        </g>
        <path d="M78 40c-6-10-20-4-14 6l8 10 9-10c4-7-1-14-3-6" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" className="anim-float" />

        {/* plant */}
        <g className="anim-sway" style={{ transformOrigin: '68px 262px' }}>
          <path d="M68 238c-2-24-18-34-30-36 4 14 14 30 30 36zM70 238c4-26 22-36 34-36-4 16-16 30-34 36zM69 236c-6-30 0-48 8-58 6 16 4 38-8 58z" fill="#7d93df" />
        </g>
        <path d="M52 238h34l-5 30H57z" fill="#c4cff7" stroke="#8a9de6" strokeWidth="2" />

        {/* booth body */}
        <rect x="112" y="40" width="130" height="226" rx="16" fill="url(#bi-body)" stroke="#7d91e0" strokeWidth="2.5" />
        <rect x="242" y="52" width="58" height="214" rx="8" fill="url(#bi-side)" stroke="#7d91e0" strokeWidth="2.5" />
        {/* curtain */}
        <g className="anim-sway" style={{ transformOrigin: '271px 60px', animationDuration: '5s' }}>
          <path d="M248 60h46v196c-8 4-16 4-23 0-7 4-15 4-23 0z" fill="#6f84de" opacity="0.92" />
          {[256, 265, 274, 283].map((x) => (
            <path key={x} d={`M${x} 62v190`} stroke="#8fa1ea" strokeWidth="2.5" />
          ))}
        </g>
        <rect x="244" y="54" width="54" height="9" rx="4" fill="#5a6fd0" />

        {/* screen with the badge */}
        <rect x="126" y="62" width="102" height="118" rx="12" fill="#eef2ff" stroke="#fff" strokeWidth="4" />
        <circle cx="177" cy="121" r="34" fill="#93a5ec" />
        <circle cx="177" cy="121" r="26" fill="#7486d0" />
        <text x="177" y="118" textAnchor="middle" fontFamily="Pacifico, cursive" fontSize="13" fill="#fff">Nivo</text>
        <text x="180" y="134" textAnchor="middle" fontFamily="Pacifico, cursive" fontSize="13" fill="#fff">Talk</text>
        {/* camera + flash */}
        <circle cx="177" cy="52" r="7" fill="#2f3a78" stroke="#fff" strokeWidth="2" />
        <circle cx="177" cy="52" r="40" fill="url(#bi-glow)" className="booth-flash" />
        {/* slot */}
        <rect x="140" y="214" width="74" height="10" rx="5" fill="#5a6fd0" />

        {/* printing strip */}
        <g clipPath="url(#bi-slot)">
          <g className="booth-print">
            <rect x="160" y="210" width="34" height="74" rx="3" fill="#fff" stroke="#c9d3fa" strokeWidth="1.5" />
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <rect x="164" y={215 + i * 22} width="26" height="18" rx="2" fill="#dfe6fd" />
                <circle cx="177" cy={222 + i * 22} r="4" fill="#9fb0ef" />
                <path d={`M170 ${232 + i * 22}a7 5 0 0 1 14 0`} fill="#9fb0ef" />
              </g>
            ))}
          </g>
        </g>

        {/* strip taped on the side */}
        <g transform="rotate(-10 106 120)">
          <rect x="92" y="88" width="26" height="62" rx="3" fill="#fff" stroke="#c9d3fa" strokeWidth="1.5" />
          <rect x="95" y="92" width="20" height="16" rx="2" fill="#dfe6fd" />
          <rect x="95" y="111" width="20" height="16" rx="2" fill="#dfe6fd" />
          <rect x="95" y="130" width="20" height="16" rx="2" fill="#dfe6fd" />
        </g>

        {/* handwritten note */}
        <text x="318" y="40" fontFamily="Caveat, cursive" fontSize="22" fill="var(--primary)" transform="rotate(14 330 40)">
          Good
        </text>
        <text x="330" y="60" fontFamily="Caveat, cursive" fontSize="22" fill="var(--primary)" transform="rotate(14 340 60)">
          Times!
        </text>
      </svg>
      {/* Dino with a camera */}
      <img
        src={stickerUrl('dino-15')}
        alt=""
        className="anim-float absolute"
        style={{ right: '1%', bottom: '4%', width: '27%' }}
        draggable={false}
      />
    </div>
  );
}
