import { useEffect, useRef, useState, type RefObject } from 'react';
import { loadYouTube, YT_STATE, type YTPlayer } from '../../lib/youtube';
import { chill, currentItem, positionOf, useChillRoom } from './chillStore';

const VOLUME_KEY = 'nivo:chill-volume';
const DRIFT_S = 1.2;

function savedVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 100 ? v : 80;
  } catch {
    return 80;
  }
}

/**
 * Drives the YouTube player from the room's shared state: loads the current song, plays or pauses with
 * everyone else and quietly seeks back into step whenever it drifts more than a second.
 */
export function useChillPlayer(host: RefObject<HTMLDivElement | null>) {
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The browser blocked sound until the person taps something. */
  const [needsTap, setNeedsTap] = useState(false);
  const [volume, setVolumeState] = useState(savedVolume);
  const loadedId = useRef<string | null>(null);
  const loadedItem = useRef<string | null>(null);
  const askedToPlayAt = useRef(0);
  const reportedDuration = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mount = document.createElement('div');
    host.current?.appendChild(mount);
    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
        new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
          events: {
            onReady: (e) => {
              if (cancelled) return e.target.destroy();
              player.current = e.target;
              e.target.setVolume(savedVolume());
              setReady(true);
            },
            onStateChange: (e) => {
              const st = useChillRoom.getState().state;
              const item = currentItem(st);
              if (!item || loadedItem.current !== item.id) return;
              if (e.data === YT_STATE.PLAYING) {
                askedToPlayAt.current = 0;
                setNeedsTap(false);
                const d = e.target.getDuration();
                if (!item.durationMs && d > 0 && reportedDuration.current !== item.id) {
                  reportedDuration.current = item.id;
                  chill.duration(item.id, d * 1000);
                }
              }
              if (e.data === YT_STATE.ENDED && st?.playing) chill.ended(item.id);
            },
            onError: () => {
              const item = currentItem(useChillRoom.getState().state);
              if (item && loadedItem.current === item.id) chill.unplayable(item.id);
            },
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      mount.remove();
    };
  }, [host]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const p = player.current;
      const st = useChillRoom.getState().state;
      if (!p || !st) return;
      const item = currentItem(st);
      const ps = p.getPlayerState();
      if (!item || st.finished) {
        if (ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING) p.pauseVideo();
        askedToPlayAt.current = 0;
        return;
      }
      const target = positionOf(st) / 1000;
      if (loadedId.current !== item.videoId || loadedItem.current !== item.id) {
        loadedId.current = item.videoId;
        loadedItem.current = item.id;
        if (st.playing) {
          p.loadVideoById({ videoId: item.videoId, startSeconds: target });
          askedToPlayAt.current = Date.now();
        } else {
          p.cueVideoById({ videoId: item.videoId, startSeconds: target });
          askedToPlayAt.current = 0;
        }
        return;
      }
      if (st.playing) {
        if (ps === YT_STATE.ENDED) return; // the server moves on to the next song
        if (ps !== YT_STATE.PLAYING && ps !== YT_STATE.BUFFERING) {
          if (!askedToPlayAt.current) askedToPlayAt.current = Date.now();
          else if (Date.now() - askedToPlayAt.current > 2500) setNeedsTap(true);
          if (ps === YT_STATE.CUED || ps === YT_STATE.PAUSED) p.seekTo(target, true);
          p.playVideo();
          return;
        }
        if (ps === YT_STATE.PLAYING && Math.abs(p.getCurrentTime() - target) > DRIFT_S) p.seekTo(target, true);
      } else {
        askedToPlayAt.current = 0;
        if (ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING) p.pauseVideo();
        if (ps === YT_STATE.PAUSED && Math.abs(p.getCurrentTime() - target) > DRIFT_S) p.seekTo(target, true);
      }
    };
    sync();
    const unsub = useChillRoom.subscribe((s, prev) => s.state !== prev.state && sync());
    const tick = setInterval(sync, 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, [ready]);

  return {
    ready,
    failed,
    needsTap,
    /** Must run inside a tap so the browser allows sound. */
    unlock() {
      const p = player.current;
      if (!p) return;
      p.unMute();
      p.seekTo(positionOf(useChillRoom.getState().state) / 1000, true);
      p.playVideo();
      askedToPlayAt.current = Date.now();
      setNeedsTap(false);
    },
    volume,
    setVolume(v: number) {
      setVolumeState(v);
      player.current?.setVolume(v);
      if (v > 0) player.current?.unMute();
      try {
        localStorage.setItem(VOLUME_KEY, String(v));
      } catch {
        /* private mode */
      }
    },
  };
}
