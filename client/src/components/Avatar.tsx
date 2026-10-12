import { frameScale, frameUrl, isFrame } from '../lib/frames';
import { BUDDY_STICKER, BUDDY_TINT, stickerUrl } from '../lib/stickers';
import type { Buddy, User } from '../lib/types';

type Props = {
  user: Pick<User, 'avatar' | 'avatarUrl' | 'displayName'> & { online?: boolean; frame?: string | null };
  size?: number;
  showOnline?: boolean;
  rounded?: 'full' | 'xl';
  className?: string;
  /** Leave the profile frame off (tight rows, stacked avatars). */
  noFrame?: boolean;
};

/** Frames only show where the avatar is big enough to make them out. */
const MIN_FRAMED = 36;

/** Profile photo, or the user's buddy character on a soft tint when there's no photo; with their frame around it. */
export function Avatar({ user, size = 44, showOnline = false, rounded = 'full', className = '', noFrame = false }: Props) {
  const frame = !noFrame && size >= MIN_FRAMED && isFrame(user.frame) ? user.frame : null;
  const radius = rounded === 'full' || frame ? '9999px' : `${Math.round(size * 0.32)}px`;
  const buddy = (user.avatar in BUDDY_STICKER ? user.avatar : 'dino') as Buddy;
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className="h-full w-full object-cover"
          style={{ borderRadius: radius }}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="grid h-full w-full place-items-center overflow-hidden" style={{ borderRadius: radius, background: BUDDY_TINT[buddy] }}>
          <img src={stickerUrl(BUDDY_STICKER[buddy])} alt={user.displayName} className="h-[86%] w-[86%] object-contain" draggable={false} />
        </span>
      )}
      {frame && (
        <img
          src={frameUrl(frame)}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
          style={{ width: size * frameScale(frame), height: size * frameScale(frame) }}
          loading="lazy"
          draggable={false}
        />
      )}
      {showOnline && user.online && (
        <span
          className="absolute rounded-full bg-online"
          style={{ width: size * 0.26, height: size * 0.26, right: 0, bottom: 0, boxShadow: '0 0 0 2.5px var(--surface)' }}
          aria-label="online"
        />
      )}
    </span>
  );
}

export function BuddyAvatar({ buddy, size = 56 }: { buddy: Buddy; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-full" style={{ width: size, height: size, background: BUDDY_TINT[buddy] }}>
      <img src={stickerUrl(BUDDY_STICKER[buddy])} alt="" className="h-[86%] w-[86%] object-contain" draggable={false} />
    </span>
  );
}
