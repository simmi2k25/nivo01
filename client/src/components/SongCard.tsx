import { player, usePlayer } from '../lib/audio';
import type { Song } from '../lib/types';
import { Icon } from './Icon';

/** Frosted "now playing" card pinned to a profile; plays the 30-second Apple preview. */
export function SongCard({ song }: { song: Song }) {
  const p = usePlayer();
  const playing = p.url === song.previewUrl && p.playing;
  const progress = p.url === song.previewUrl ? p.progress : 0;
  return (
    <button
      onClick={() => player.toggle(song.previewUrl)}
      className="anim-rise relative flex max-w-[250px] items-center gap-2.5 overflow-hidden rounded-2xl bg-white/18 py-2 pr-3 pl-2 text-left text-white shadow-lg ring-1 ring-white/25 backdrop-blur-md"
      aria-label={`${playing ? 'Pause' : 'Play'} ${song.title} by ${song.artist}`}
    >
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/20">
        {song.artwork && <img src={song.artwork} alt="" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          {playing ? <Bars /> : <Icon name="play" size={16} />}
        </span>
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[13px] font-bold">
          <Icon name="music" size={12} className="shrink-0" />
          <span className="truncate">{song.title}</span>
        </span>
        <span className="block truncate text-[11.5px] opacity-80">{song.artist}</span>
      </span>
      <span className="absolute bottom-0 left-0 h-[3px] bg-white/80 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
    </button>
  );
}

export function Bars() {
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className="block h-full w-[3px] origin-bottom rounded-full bg-white" style={{ animation: `bar-dance 0.9s ${i * 0.12}s ease-in-out infinite` }} />
      ))}
    </span>
  );
}
