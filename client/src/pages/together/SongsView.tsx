import { useEffect, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { searchSongs, type Track } from '../../components/SongPicker';
import { toast } from '../../components/Toast';
import type { ChillItem, ChillState, User } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { chill, currentItem, positionOf } from './chillStore';
import { CoverArt, fmtTime, fmtTotal } from './parts';

const YT_LINK = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;

/** Search any song and add it; below, what's playing and what's up next. */
export function SongsView({ state, onBack }: { state: ChillState | null; onBack: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState<'idle' | 'loading' | 'error'>('idle');
  const isLink = YT_LINK.test(q.trim());

  useEffect(() => {
    const term = q.trim();
    if (!term || YT_LINK.test(term)) return setResults([]);
    const c = new AbortController();
    const t = setTimeout(() => {
      setSearching('loading');
      searchSongs(term, c.signal)
        .then((r) => {
          setResults(r.filter((x) => x.trackId && x.trackName));
          setSearching('idle');
        })
        .catch((e) => e.name !== 'AbortError' && setSearching('error'));
    }, 350);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);

  const listeners = state?.listeners.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="safe-top shrink-0 lg:border-b lg:border-line lg:bg-surface/80 lg:backdrop-blur">
        <div className="flex h-[72px] items-center gap-3 px-3 lg:px-6">
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm lg:bg-primary-soft lg:shadow-none" onClick={onBack} aria-label="Back to the room">
            <Icon name="back" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold">Songs</h1>
            <p className="truncate text-[13px] font-bold text-primary-strong">Chill Room · {listeners} listening</p>
          </div>
          <button className="btn btn-soft hidden h-11 lg:inline-flex" onClick={onBack}>
            <Icon name="chat" size={19} /> Back to chat
          </button>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 pt-2 pb-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8 lg:px-8 lg:pt-6">
          <section className="min-w-0">
            <label className="field h-14 !border-2 !border-primary bg-surface !px-5 text-[17px]">
              <Icon name="search" size={22} className="text-primary" />
              <input className="outline-none" placeholder="Search any song or artist" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
              {searching === 'loading' && <span className="anim-spin h-4 w-4 rounded-full border-2 border-primary-soft border-t-primary" />}
              {q && (
                <button type="button" className="text-faint" onClick={() => setQ('')} aria-label="Clear search">
                  <Icon name="x" size={18} />
                </button>
              )}
            </label>

            {isLink ? (
              <>
                <h2 className="mt-5 mb-2 px-1 text-xl font-bold">YouTube link</h2>
                <LinkRow link={q.trim()} onAdded={() => setQ('')} />
              </>
            ) : q.trim() ? (
              <>
                <h2 className="mt-5 mb-2 px-1 text-xl font-bold">Results</h2>
                {searching === 'error' && <p className="py-4 text-center text-sm text-danger">Couldn’t search right now — try again.</p>}
                {searching === 'idle' && results.length === 0 && <p className="py-4 text-center text-sm text-muted">No songs found for “{q.trim()}”.</p>}
                <div className="grid grid-cols-1 gap-2">
                  {results.map((t) => (
                    <ResultRow key={t.trackId} t={t} />
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-[24px] bg-surface/70 p-5 text-center">
                <p className="font-bold">Find a song for everyone 🎧</p>
                <p className="mt-1 text-sm text-muted">Songs play in full, in sync for the whole room. You can also paste a YouTube link.</p>
              </div>
            )}
          </section>

          <Queue state={state} />
        </div>
      </div>

      <MiniPlayer state={state} onOpen={onBack} />
    </div>
  );
}

function ResultRow({ t }: { t: Track }) {
  const [st, setSt] = useState<'idle' | 'adding' | 'added'>('idle');
  async function add() {
    setSt('adding');
    const err = await chill.add({
      trackId: t.trackId,
      title: t.trackName,
      artist: t.artistName,
      artwork: t.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
      durationMs: t.trackTimeMillis ?? null,
    });
    if (err) {
      toast(err, 'error');
      setSt('idle');
    } else setSt('added');
  }
  return (
    <div className="flex items-center gap-3.5 rounded-[22px] bg-surface p-2.5 pr-3 shadow-[var(--shadow-sm)]">
      <CoverArt src={t.artworkUrl100} seed={String(t.trackId)} className="h-14 w-14 shrink-0 lg:h-[60px] lg:w-[60px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold">{t.trackName}</span>
        <span className="block truncate text-muted">
          {t.artistName}
          <span className="lg:hidden"> · {fmtTime(t.trackTimeMillis)}</span>
        </span>
      </span>
      <span className="hidden text-sm font-bold text-muted tabular-nums lg:block">{fmtTime(t.trackTimeMillis)}</span>
      <AddButton st={st} onAdd={add} />
    </div>
  );
}

function AddButton({ st, onAdd }: { st: 'idle' | 'adding' | 'added'; onAdd: () => void }) {
  return (
    <button
      className="grid h-12 min-w-12 shrink-0 place-items-center rounded-full bg-primary-soft px-0 font-display font-semibold text-primary-strong transition active:scale-95 disabled:opacity-70 lg:flex lg:gap-1.5 lg:px-5"
      onClick={onAdd}
      disabled={st !== 'idle'}
      aria-label={st === 'added' ? 'Added' : 'Add to the queue'}
    >
      {st === 'adding' ? (
        <span className="anim-spin h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary" />
      ) : (
        <Icon name={st === 'added' ? 'check' : 'plus'} size={24} />
      )}
      <span className="hidden lg:inline">{st === 'added' ? 'Added' : 'Add'}</span>
    </button>
  );
}

function LinkRow({ link, onAdded }: { link: string; onAdded: () => void }) {
  const [st, setSt] = useState<'idle' | 'adding' | 'added'>('idle');
  async function add() {
    setSt('adding');
    const err = await chill.add({ link });
    if (err) {
      toast(err, 'error');
      setSt('idle');
    } else {
      setSt('added');
      toast('Added to the queue');
      onAdded();
    }
  }
  return (
    <div className="flex items-center gap-3.5 rounded-[22px] bg-surface p-2.5 pr-3 shadow-[var(--shadow-sm)]">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#ff3b30]/10 text-[#e0352b]">
        <Icon name="play" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">Add this video</span>
        <span className="block truncate text-sm text-muted">{link}</span>
      </span>
      <AddButton st={st} onAdd={add} />
    </div>
  );
}

// ---------------------------------------------------------------- queue

function Queue({ state }: { state: ChillState | null }) {
  const me = useAuth((s) => s.user)!;
  const [menu, setMenu] = useState<ChillItem | null>(null);
  const items = state && !state.finished ? state.queue.slice(state.index) : [];
  const playedFor = positionOf(state);
  const left = items.reduce((sum, it, i) => sum + Math.max(0, (it.durationMs ?? 0) - (i === 0 ? playedFor : 0)), 0);

  return (
    <section className="min-w-0 lg:self-start lg:rounded-[32px] lg:bg-surface/80 lg:p-5 lg:shadow-[var(--shadow)]">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="flex-1 text-xl font-bold">
          Queue · {items.length} {items.length === 1 ? 'song' : 'songs'}
        </h2>
        {items.length > 2 && (
          <button className="icon-btn !h-9 !w-9" onClick={chill.shuffle} aria-label="Shuffle what’s up next" title="Shuffle">
            <Icon name="shuffle" size={19} />
          </button>
        )}
        {left > 0 && <span className="text-sm font-bold text-muted">{fmtTotal(left)}</span>}
      </div>
      {items.length === 0 && <p className="rounded-[22px] bg-surface/70 p-5 text-center text-sm text-muted">The queue is empty — add a song above.</p>}
      <div className="grid grid-cols-1 gap-2">
        {items.map((it, i) => (
          <button
            key={it.id}
            className={`flex items-center gap-3.5 rounded-[22px] p-2.5 pr-3 text-left transition ${i === 0 ? 'bg-primary-soft' : 'bg-surface shadow-[var(--shadow-sm)] hover:bg-surface-2'}`}
            onClick={() => i > 0 && setMenu(it)}
            disabled={i === 0}
          >
            <CoverArt src={it.artwork} seed={it.id} className="h-14 w-14 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold">{it.title}</span>
              <span className="block truncate text-muted">
                {it.artist} · {i === 0 ? (state?.playing ? 'Now playing' : 'Paused') : i === 1 ? 'Next' : fmtTime(it.durationMs)}
              </span>
            </span>
            {it.by && (
              <span title={`Added by ${it.by.id === me.id ? 'you' : it.by.displayName}`}>
                <Avatar user={{ ...it.by, avatar: it.by.avatar as User['avatar'] }} size={34} />
              </span>
            )}
          </button>
        ))}
      </div>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title}>
        {menu && (
          <div className="grid gap-1">
            <button
              className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold hover:bg-surface-2"
              onClick={() => {
                chill.jump(menu.id);
                setMenu(null);
              }}
            >
              <Icon name="play" className="text-primary" /> Play now for everyone
            </button>
            {(menu.addedBy === me.id || state?.hostId === me.id) && (
              <button
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold text-danger hover:bg-surface-2"
                onClick={() => {
                  chill.remove(menu.id);
                  setMenu(null);
                }}
              >
                <Icon name="trash" /> Remove from the queue
              </button>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
}

function MiniPlayer({ state, onOpen }: { state: ChillState | null; onOpen: () => void }) {
  const item = state?.finished ? null : currentItem(state);
  const playing = !!state?.playing;
  return (
    <div className="safe-bottom shrink-0 px-3 pb-3 lg:px-8 lg:pb-6">
      <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-[28px] bg-surface p-2.5 pr-3 shadow-[var(--shadow)]">
        <button className="flex min-w-0 flex-1 items-center gap-3.5 text-left" onClick={onOpen}>
          <CoverArt src={item?.artwork} seed={item?.id ?? 'ph0'} className="h-14 w-14 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-bold">{item?.title ?? 'Nothing playing'}</span>
            <span className="block truncate text-sm text-muted">{item ? `${playing ? 'Playing' : 'Paused'} · tap to go back to the room` : 'Tap to go back to the room'}</span>
          </span>
        </button>
        <button className="hidden text-ink transition active:scale-90 disabled:opacity-30 lg:block" onClick={() => chill.control('prev')} disabled={!item} aria-label="Previous song">
          <Icon name="skipBack" size={28} />
        </button>
        <button
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-b from-primary to-primary-strong text-white shadow-md transition active:scale-95 disabled:opacity-50"
          onClick={() => chill.control(playing ? 'pause' : 'play')}
          disabled={!item}
          aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={24} />
        </button>
        <button
          className="hidden text-ink transition active:scale-90 disabled:opacity-30 lg:block"
          onClick={() => chill.control('next')}
          disabled={!state || state.index >= state.queue.length - 1}
          aria-label="Next song"
        >
          <Icon name="skipForward" size={28} />
        </button>
      </div>
    </div>
  );
}
