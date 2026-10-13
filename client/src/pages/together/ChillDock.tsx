import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { chill, currentItem, leaveChill, useChillRoom } from './chillStore';
import { CoverArt } from './parts';
import { useChillPlayer } from './useChillPlayer';

export type Yt = ReturnType<typeof useChillPlayer>;

/**
 * The room's player outlives the room page: it lives here, under the app shell, so the music keeps going
 * while you hop back to your chats. The room page borrows it through this store.
 */
type ChillAudio = {
  yt: Yt | null;
  /** The front cover card on the room page, where the video shows when someone asks for it. */
  slot: HTMLElement | null;
  video: boolean;
};

export const useChillAudio = create<ChillAudio>(() => ({ yt: null, slot: null, video: false }));

/** Mounted by the app shell while you're in a Chill Room: keeps the player alive and shows the mini bar elsewhere. */
export default function ChillDock({ showBar }: { showBar: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const yt = useChillPlayer(host);
  const video = useChillAudio((s) => s.video);
  const slot = useChillAudio((s) => s.slot);
  const status = useChillRoom((s) => s.status);
  const showVideo = video && !!slot && !yt.needsTap && !showBar;

  useEffect(() => {
    useChillAudio.setState({ yt });
  });

  useEffect(() => () => useChillAudio.setState({ yt: null, video: false }), []);

  // Away from the room page, a room that closes (or can't be rejoined) just lets you go.
  useEffect(() => {
    if (!showBar) return;
    if (status === 'closed') toast('The Chill Room has closed', 'info');
    if (status === 'closed' || status === 'error') leaveChill();
  }, [showBar, status]);

  // Pin the (otherwise invisible) player over the front cover card while the video is on.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (!showVideo || !slot) {
      el.removeAttribute('style');
      return;
    }
    let raf = 0;
    const place = () => {
      const r = slot.getBoundingClientRect();
      const on = r.width > 0 && r.height > 0;
      Object.assign(el.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        opacity: on ? '1' : '0',
        zIndex: on ? '25' : '-1',
        pointerEvents: on ? 'auto' : 'none',
      });
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [showVideo, slot]);

  return (
    <>
      <div ref={frame} className="pointer-events-none fixed bottom-0 left-0 -z-10 h-[200px] w-[200px] overflow-hidden rounded-[20px] bg-black opacity-0" aria-hidden={!showVideo}>
        <div ref={host} className="pointer-events-none absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
        {showVideo && (
          <button
            className="absolute right-2 bottom-2 flex h-7 items-center gap-1 rounded-full bg-black/40 px-2.5 text-[11px] font-bold text-white backdrop-blur"
            onClick={() => useChillAudio.setState({ video: false })}
          >
            <Icon name="image" size={12} /> Cover
          </button>
        )}
      </div>
      {showBar && <MiniBar yt={yt} />}
    </>
  );
}

/** The slim "now playing" strip shown at the top of every other screen while you're in a room. */
function MiniBar({ yt }: { yt: Yt }) {
  const nav = useNavigate();
  const code = useChillRoom((s) => s.code);
  const state = useChillRoom((s) => s.state);
  const status = useChillRoom((s) => s.status);
  const item = currentItem(state);
  const playing = !!state?.playing && !state.finished;
  const listeners = state?.listeners.length ?? 0;
  const open = () => code && nav(`/chill/${code}`);

  return (
    <div className="safe-top relative z-30 shrink-0 bg-gradient-to-r from-primary to-primary-strong text-white shadow-[0_4px_16px_rgba(90,111,208,0.3)]">
      <div className="flex h-14 items-center gap-2.5 pr-1.5 pl-3">
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={open} aria-label="Back to the Chill Room">
          <span className="relative shrink-0">
            <CoverArt src={item?.artwork} seed={item?.id ?? 'ph0'} className="h-10 w-10 ring-2 ring-white/40" rounded="rounded-xl" />
            {playing && (
              <span className="absolute -right-1 -bottom-1 flex h-4 items-end gap-[2px] rounded-full bg-white px-1 pb-[3px]">
                <span className="chill-eq h-2 w-[2px] rounded-full bg-primary-strong" />
                <span className="chill-eq h-2 w-[2px] rounded-full bg-primary-strong [animation-delay:-0.3s]" />
                <span className="chill-eq h-2 w-[2px] rounded-full bg-primary-strong [animation-delay:-0.6s]" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-tight font-bold">{item && !state?.finished ? item.title : 'Chill Room'}</span>
            <span className="block truncate text-xs font-semibold text-white/80">
              {status !== 'live'
                ? 'Reconnecting…'
                : yt.needsTap && playing
                  ? 'Tap play to listen in sync'
                  : `${item && !state?.finished ? `${item.artist} · ` : ''}${listeners} listening · tap to open`}
            </span>
          </span>
        </button>
        <button
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-primary-strong shadow-md transition active:scale-90 disabled:opacity-50"
          onClick={() => (yt.needsTap && playing ? yt.unlock() : chill.control(playing ? 'pause' : 'play'))}
          disabled={!item}
          aria-label={yt.needsTap && playing ? 'Listen in sync' : playing ? 'Pause for everyone' : 'Play for everyone'}
        >
          <Icon name={playing && !yt.needsTap ? 'pause' : 'play'} size={18} />
        </button>
        <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/90 transition active:scale-90" onClick={leaveChill} aria-label="Leave the Chill Room">
          <Icon name="x" size={20} />
        </button>
      </div>
    </div>
  );
}

/** Hook for the room page: the shared player, plus a ref to hand it the cover card it shows the video on. */
export function useDockedPlayer() {
  const yt = useChillAudio((s) => s.yt);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    useChillAudio.setState({ slot: el });
    return () => {
      if (useChillAudio.getState().slot === el) useChillAudio.setState({ slot: null });
    };
  }, [el]);
  return { yt, slotRef: setEl };
}
