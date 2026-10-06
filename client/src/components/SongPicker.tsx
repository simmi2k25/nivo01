import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { player, usePlayer, useStopOnLeave } from '../lib/audio';
import type { Song } from '../lib/types';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Bars } from './SongCard';

type Track = { trackId: number; trackName: string; artistName: string; artworkUrl100?: string; previewUrl?: string; trackViewUrl?: string };

/** Country from the phone's language setting (e.g. en-IN → IN) so local music shows up. */
export function deviceCountry() {
  const tag = navigator.language || 'en-US';
  const region = tag.split(/[-_]/)[1];
  return region && /^[a-zA-Z]{2}$/.test(region) ? region.toUpperCase() : 'US';
}

async function searchSongs(term: string, signal: AbortSignal): Promise<Track[]> {
  const params = new URLSearchParams({ term, media: 'music', entity: 'song', limit: '25', country: deviceCountry() });
  try {
    // Straight from the browser to Apple: spreads rate limits across users instead of the server.
    const r = await fetch(`https://itunes.apple.com/search?${params}`, { signal });
    if (!r.ok) throw new Error();
    return (await r.json()).results ?? [];
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const r = await api<{ results: Track[] }>(`/users/song-search?q=${encodeURIComponent(term)}&country=${deviceCountry()}`, { signal });
    return r.results ?? [];
  }
}

export function toSong(t: Track): Song {
  return {
    trackId: t.trackId,
    title: t.trackName,
    artist: t.artistName,
    artwork: t.artworkUrl100?.replace('100x100bb', '300x300bb') ?? null,
    previewUrl: t.previewUrl ?? '',
    url: t.trackViewUrl ?? null,
  };
}

export function SongPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (s: Song) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const p = usePlayer();
  useStopOnLeave();

  useEffect(() => {
    const term = q.trim();
    if (!term) return setResults([]);
    const c = new AbortController();
    const t = setTimeout(() => {
      setState('loading');
      searchSongs(term, c.signal)
        .then((r) => {
          setResults(r.filter((x) => x.previewUrl && x.trackId));
          setState('idle');
        })
        .catch((e) => e.name !== 'AbortError' && setState('error'));
    }, 350);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        player.stop();
        onClose();
      }}
      title="Add a song"
    >
      <label className="field h-11">
        <Icon name="search" size={18} className="text-faint" />
        <input autoFocus placeholder="Search songs or artists" value={q} onChange={(e) => setQ(e.target.value)} />
        {state === 'loading' && <span className="anim-spin h-4 w-4 rounded-full border-2 border-primary-soft border-t-primary" />}
      </label>
      {state === 'error' && <p className="py-4 text-center text-sm text-danger">Couldn’t reach Apple Music — try again.</p>}
      {!q && <p className="py-8 text-center text-sm text-muted">Tap a cover to hear a preview, then pick your song 🎵</p>}
      <div className="mt-2 grid grid-cols-1 gap-1">
        {results.map((t) => {
          const playing = p.url === t.previewUrl && p.playing;
          return (
            <div key={t.trackId} className="flex items-center gap-3 rounded-2xl px-1.5 py-1.5 hover:bg-surface-2">
              <button className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-primary-soft" onClick={() => player.toggle(t.previewUrl!)} aria-label={`Preview ${t.trackName}`}>
                {t.artworkUrl100 && <img src={t.artworkUrl100} alt="" className="h-full w-full object-cover" loading="lazy" />}
                <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">{playing ? <Bars /> : <Icon name="play" size={16} />}</span>
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{t.trackName}</span>
                <span className="block truncate text-xs text-muted">{t.artistName}</span>
              </span>
              <button
                className="btn btn-soft btn-sm shrink-0"
                onClick={() => {
                  player.stop();
                  onPick(toSong(t));
                }}
              >
                Use
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
