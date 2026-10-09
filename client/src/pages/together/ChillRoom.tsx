import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { copyText } from '../../lib/share';
import type { ChillLine, ChillState, User } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { GroupAvatar } from '../Chats';
import { chill, currentItem, joinChill, leaveChill, positionOf, useChillRoom } from './chillStore';
import { AvatarStack, CoverArt, fmtTime } from './parts';
import { SongsView } from './SongsView';
import { useChillPlayer } from './useChillPlayer';

export default function ChillRoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const loc = useLocation();
  const status = useChillRoom((s) => s.status);
  const error = useChillRoom((s) => s.error);
  const state = useChillRoom((s) => s.state);
  const [view, setView] = useState<'room' | 'songs'>('room');
  const [people, setPeople] = useState(false);
  const playerHost = useRef<HTMLDivElement>(null);
  const yt = useChillPlayer(playerHost);

  useEffect(() => {
    joinChill(code);
    return () => leaveChill();
  }, [code]);

  // Back goes wherever they came from (a chat, Together); a shared link has nowhere to go back to.
  const back = () => (loc.key !== 'default' ? nav(-1) : nav('/together'));
  const listeners = state?.listeners ?? [];

  return (
    <div className="chill-bg relative flex h-full flex-col overflow-hidden">
      {/* ---------- room ---------- */}
      <div className={view === 'room' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <header className="safe-top relative z-20 shrink-0 lg:border-b lg:border-line lg:bg-surface/80 lg:backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-3 lg:h-[72px] lg:px-6">
            <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm lg:bg-primary-soft lg:shadow-none" onClick={back} aria-label="Back">
              <Icon name="back" />
            </button>
            <div className="min-w-0 flex-1 text-center lg:text-left">
              <h1 className="truncate text-[22px] leading-tight font-bold lg:text-2xl">Chill Room</h1>
              <p className="flex items-center justify-center gap-1.5 truncate text-[13px] font-bold text-primary-strong lg:justify-start">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#3b82f6]" />
                {listeners.length > 1 ? (
                  <>
                    <span className="lg:hidden">Synced with {listeners.length} listeners</span>
                    <span className="hidden lg:inline">Everyone is in sync · {listeners.length} listening</span>
                  </>
                ) : (
                  'Just you so far — invite friends'
                )}
              </p>
            </div>
            <span className="hidden lg:block">
              <AvatarStack users={listeners} max={3} size={38} />
            </span>
            <button className="btn btn-soft hidden h-11 lg:inline-flex" onClick={() => setPeople(true)}>
              <Icon name="userPlus" size={19} /> Invite
            </button>
            <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm lg:hidden" onClick={() => setPeople(true)} aria-label="People and invites">
              <Icon name="users" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Stage state={state} playerHost={playerHost} yt={yt} />
            <div className="hidden lg:block">
              <DesktopNow state={state} onSongs={() => setView('songs')} />
            </div>
            <div className="hidden flex-1 lg:block" />
            <div className="hidden px-8 pb-6 lg:block">
              <PlayerBar state={state} yt={yt} />
            </div>
            {/* phone: now playing + chat on one white sheet */}
            <section className="relative z-10 flex min-h-0 flex-1 flex-col rounded-t-[32px] bg-surface shadow-[0_-8px_30px_rgba(90,111,208,0.10)] lg:hidden">
              <PhoneNow state={state} onSongs={() => setView('songs')} />
              <RoomChat />
            </section>
          </div>
          <aside className="hidden min-h-0 flex-col rounded-tl-[32px] bg-surface shadow-[-8px_0_30px_rgba(90,111,208,0.08)] lg:flex">
            <RoomChat />
          </aside>
        </div>
      </div>

      {/* ---------- songs & queue ---------- */}
      {view === 'songs' && <SongsView state={state} onBack={() => setView('room')} />}

      <PeopleSheet open={people} onClose={() => setPeople(false)} state={state} code={code} />

      {status !== 'live' && (
        <div className="chill-bg absolute inset-0 z-30 grid place-items-center p-8 text-center">
          {status === 'joining' ? (
            <div className="grid justify-items-center gap-3">
              <span className="anim-spin h-9 w-9 rounded-full border-[3px] border-primary-soft border-t-primary" />
              <p className="font-bold text-muted">Tuning in…</p>
            </div>
          ) : (
            <div className="card grid max-w-sm justify-items-center gap-3 p-7">
              <span className="grid h-16 w-16 place-items-center rounded-3xl bg-primary-soft text-primary">
                <Icon name="music" size={30} />
              </span>
              <h2 className="text-xl font-bold">{status === 'closed' ? 'This Chill Room has closed' : 'Couldn’t join the room'}</h2>
              <p className="text-sm text-muted">{status === 'closed' ? 'Open a new one from the Together tab.' : error}</p>
              <div className="flex gap-2">
                {status === 'error' && (
                  <button className="btn btn-soft btn-sm" onClick={() => joinChill(code)}>
                    Try again
                  </button>
                )}
                <button className="btn btn-primary btn-sm" onClick={() => nav('/together')}>
                  Go to Together
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Yt = ReturnType<typeof useChillPlayer>;

/** Re-renders a few times a second so progress bars move. */
function usePosition(state: ChillState | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!state?.playing) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [state?.playing]);
  return positionOf(state);
}

// ---------------------------------------------------------------- covers

function Stage({ state, playerHost, yt }: { state: ChillState | null; playerHost: React.RefObject<HTMLDivElement | null>; yt: Yt }) {
  const [video, setVideo] = useState(false);
  const item = currentItem(state);
  const slots = [-2, -1, 0, 1, 2].map((o) => ({ o, item: state?.queue[(state?.index ?? 0) + o] ?? null }));

  return (
    <div className="chill-stage relative shrink-0 overflow-hidden">
      {slots.map(({ o, item: it }) => (
        <div
          key={it?.id ?? `ph${o}`}
          className={`chill-card ${Math.abs(o) === 2 ? 'max-lg:hidden' : ''}`}
          style={{ '--o': o, '--a': Math.abs(o), zIndex: 10 - Math.abs(o) } as React.CSSProperties}
          aria-hidden="true"
        >
          <CoverArt src={it?.artwork} seed={it?.id ?? `ph${o}`} className="h-full w-full" rounded="rounded-[20px]" />
        </div>
      ))}

      {/* The live player sits in the middle card, under the cover unless someone wants the video. */}
      <div className="chill-card chill-front" style={{ '--o': 0, '--a': 0, zIndex: 20 } as React.CSSProperties}>
        <div className="relative h-full w-full overflow-hidden rounded-[20px] bg-black">
          <div ref={playerHost} className="pointer-events-none absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
          <CoverArt
            src={item?.artwork}
            seed={item?.id ?? 'ph0'}
            className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${video && item ? 'opacity-0' : ''}`}
            rounded="rounded-[20px]"
          />
          {item && (
            <button
              className="absolute right-2 bottom-2 flex h-7 items-center gap-1 rounded-full bg-black/40 px-2.5 text-[11px] font-bold text-white backdrop-blur"
              onClick={() => setVideo((v) => !v)}
              aria-pressed={video}
            >
              <Icon name={video ? 'image' : 'play'} size={12} /> {video ? 'Cover' : 'Video'}
            </button>
          )}
          {yt.needsTap && state?.playing && (
            <button className="absolute inset-0 grid place-items-center bg-[#1b2148]/45 p-3 text-center text-white backdrop-blur-[2px]" onClick={yt.unlock}>
              <span className="grid justify-items-center gap-2">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-primary-strong shadow-lg">
                  <Icon name="play" size={24} />
                </span>
                <span className="text-sm font-extrabold">Tap to listen in sync</span>
              </span>
            </button>
          )}
          {yt.failed && <p className="absolute inset-x-2 bottom-10 rounded-xl bg-black/50 p-2 text-center text-xs font-bold text-white">Couldn’t load the player — check your connection</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- now playing

function Progress({ state, compact = false }: { state: ChillState | null; compact?: boolean }) {
  const pos = usePosition(state);
  const item = currentItem(state);
  const dur = item?.durationMs ?? null;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (state?.finished ? (dur ?? 0) : pos);
  const pct = dur ? Math.min(100, (shown / dur) * 100) : 0;
  const commit = () => {
    if (drag != null) chill.seek(drag);
    setDrag(null);
  };
  return (
    <div className={compact ? '' : 'mt-3'}>
      <input
        type="range"
        className="chill-range w-full"
        min={0}
        max={dur ?? 1}
        step={1000}
        value={dur ? shown : 0}
        disabled={!dur || !item}
        style={{ '--p': `${pct}%` } as React.CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => setDrag(null)}
        aria-label="Song position"
      />
      {!compact && (
        <div className="mt-0.5 flex justify-between text-[13px] font-bold text-muted tabular-nums">
          <span>{fmtTime(item ? shown : 0)}</span>
          <span>{fmtTime(dur)}</span>
        </div>
      )}
    </div>
  );
}

function Controls({ state, size = 64 }: { state: ChillState | null; size?: number }) {
  const item = currentItem(state);
  const playing = !!state?.playing;
  const hasNext = !!state && state.index < state.queue.length - 1;
  return (
    <div className="flex items-center justify-center gap-7">
      <button className="text-ink transition active:scale-90 disabled:opacity-30" onClick={() => chill.control('prev')} disabled={!item} aria-label="Previous song">
        <Icon name="skipBack" size={30} />
      </button>
      <button
        className="grid place-items-center rounded-full bg-gradient-to-b from-primary to-primary-strong text-white shadow-[0_10px_24px_rgba(90,111,208,0.45)] transition active:scale-95 disabled:opacity-50"
        style={{ width: size, height: size }}
        onClick={() => chill.control(playing ? 'pause' : 'play')}
        disabled={!item}
        aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={size * 0.42} />
      </button>
      <button className="text-ink transition active:scale-90 disabled:opacity-30" onClick={() => chill.control('next')} disabled={!hasNext} aria-label="Next song">
        <Icon name="skipForward" size={30} />
      </button>
    </div>
  );
}

function SongsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-primary h-12 shrink-0 px-5 text-[17px]" onClick={onClick}>
      <Icon name="music" size={20} /> Songs
    </button>
  );
}

function nowLabel(state: ChillState | null) {
  const item = currentItem(state);
  if (!item) return { title: 'No songs yet', sub: 'Tap Songs to add the first one' };
  if (state?.finished) return { title: 'That’s the whole queue', sub: 'Add more songs to keep it going' };
  return { title: item.title, sub: item.artist };
}

function PhoneNow({ state, onSongs }: { state: ChillState | null; onSongs: () => void }) {
  const { title, sub } = nowLabel(state);
  return (
    <div className="shrink-0 border-b border-line px-5 pt-5 pb-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[26px] leading-tight font-bold">{title}</h2>
          <p className="truncate text-muted">{sub}</p>
        </div>
        <SongsButton onClick={onSongs} />
      </div>
      <Progress state={state} />
      <div className="mt-1">
        <Controls state={state} />
      </div>
    </div>
  );
}

function DesktopNow({ state, onSongs }: { state: ChillState | null; onSongs: () => void }) {
  const { title, sub } = nowLabel(state);
  const item = currentItem(state);
  return (
    <div className="flex items-center justify-center gap-6 px-8 pt-2">
      <div className="min-w-0 text-center">
        <h2 className="truncate text-[34px] leading-tight font-bold">{title}</h2>
        <p className="truncate text-muted">
          {sub}
          {item?.by && !state?.finished && ` · added by ${item.by.displayName}`}
        </p>
      </div>
      <SongsButton onClick={onSongs} />
    </div>
  );
}

export function PlayerBar({ state, yt, onOpen }: { state: ChillState | null; yt?: Yt; onOpen?: () => void }) {
  const item = currentItem(state);
  const pos = usePosition(state);
  return (
    <div className="card flex items-center gap-5 !rounded-[32px] px-6 py-4">
      <Controls state={state} size={58} />
      <button className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-surface-2 p-2.5 text-left" onClick={onOpen} disabled={!onOpen}>
        <CoverArt src={item?.artwork} seed={item?.id ?? 'ph0'} className="h-12 w-12 shrink-0" rounded="rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">
              <b className="font-bold">{item?.title ?? 'Nothing playing'}</b> <span className="text-sm text-muted">{item?.artist}</span>
            </span>
            <span className="shrink-0 text-xs font-bold text-muted tabular-nums">
              {fmtTime(item ? pos : 0)} / {fmtTime(item?.durationMs)}
            </span>
          </span>
          <Progress state={state} compact />
        </span>
      </button>
      {yt && (
        <div className="flex shrink-0 items-center gap-3">
          <button className="icon-btn" onClick={chill.shuffle} aria-label="Shuffle what’s up next" title="Shuffle the queue">
            <Icon name="shuffle" />
          </button>
          <button className="icon-btn" onClick={() => yt.setVolume(yt.volume ? 0 : 80)} aria-label={yt.volume ? 'Mute' : 'Unmute'}>
            <Icon name={yt.volume ? 'volume' : 'volumeOff'} />
          </button>
          <input
            type="range"
            className="chill-range w-28"
            min={0}
            max={100}
            value={yt.volume}
            style={{ '--p': `${yt.volume}%` } as React.CSSProperties}
            onChange={(e) => yt.setVolume(Number(e.target.value))}
            aria-label="Volume (just for you)"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- chat

function RoomChat() {
  const me = useAuth((s) => s.user)!;
  const lines = useChillRoom((s) => s.chat);
  const online = useChillRoom((s) => s.state?.listeners.length ?? 0);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    chill.say(t);
    setText('');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline justify-between px-5 pt-4 pb-1 lg:px-7 lg:pt-6">
        <h2 className="text-xl font-bold lg:text-2xl">Room chat</h2>
        <span className="text-sm font-bold text-muted">{online} online</span>
      </div>
      <div ref={list} className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2 lg:px-6">
        <div className="flex-1" />
        {lines.length === 0 && <p className="py-6 text-center text-sm text-muted">Say hi — everyone in the room sees it 👋</p>}
        {lines.map((l, i) => (
          <ChatRow key={l.id} line={l} meId={me.id} grouped={i > 0 && lines[i - 1].kind === 'text' && l.kind === 'text' && lines[i - 1].user?.id === l.user?.id} />
        ))}
      </div>
      <form onSubmit={send} className="safe-bottom shrink-0 px-3 pt-1 pb-3 lg:px-5">
        <div className="flex items-center gap-2 rounded-full bg-primary-soft/70 p-1.5 pl-5">
          <input
            className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-faint"
            placeholder="Write a comment…"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            enterKeyHint="send"
          />
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-white shadow-md transition active:scale-90 disabled:opacity-50" disabled={!text.trim()} aria-label="Send">
            <Icon name="send" size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatRow({ line, meId, grouped }: { line: ChillLine; meId: number; grouped: boolean }) {
  const mine = line.user?.id === meId;
  if (line.kind === 'event') {
    const who = line.user ? (mine ? 'You' : line.user.displayName) : '';
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[90%] rounded-full bg-primary-soft px-4 py-1.5 text-center text-[13px] font-bold text-primary-strong">
          {who} {line.text}
        </span>
      </div>
    );
  }
  const u = line.user!;
  const avatar = <span className={`w-9 shrink-0 ${grouped ? 'invisible' : ''}`}>{<Avatar user={{ ...u, avatar: u.avatar as User['avatar'] }} size={36} />}</span>;
  return (
    <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped ? 'mt-1' : 'mt-2.5'}`}>
      {avatar}
      <div
        className={`max-w-[78%] rounded-[20px] px-3.5 py-2 break-words whitespace-pre-wrap ${
          mine ? 'rounded-br-md bg-[var(--bubble-me)] text-[var(--bubble-me-text)]' : 'rounded-bl-md bg-primary-soft/70'
        }`}
      >
        {!grouped && <span className={`block text-xs font-extrabold ${mine ? 'opacity-90' : 'text-primary-strong'}`}>{mine ? 'You' : u.displayName}</span>}
        <span className="text-[15px] leading-snug">{line.text}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- people & invites

function PeopleSheet({ open, onClose, state, code }: { open: boolean; onClose: () => void; state: ChillState | null; code: string }) {
  const me = useAuth((s) => s.user)!;
  const nav = useNavigate();
  const conversations = useChat((s) => s.conversations);
  const [sent, setSent] = useState<number[]>([]);
  const isHost = state?.hostId === me.id;

  async function invite(conversationId: number) {
    try {
      await api(`/chill/${code}/invite`, { body: { conversationId } });
      setSent((s) => [...s, conversationId]);
      toast('Invite sent 💌');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function close() {
    if (!confirm('Close this Chill Room for everyone?')) return;
    try {
      await api(`/chill/${code}/close`, { method: 'POST' });
      nav('/together');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const sorted = state?.conversationId ? [...conversations].sort((a) => (a.id === state.conversationId ? -1 : 0)) : conversations;

  return (
    <Sheet open={open} onClose={onClose} title="In the room">
      <div className="grid gap-1">
        {(state?.listeners ?? []).map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5">
            <Avatar user={u} size={40} showOnline />
            <span className="min-w-0 flex-1 truncate font-bold">
              {u.displayName}
              {u.id === me.id && <span className="font-semibold text-muted"> (you)</span>}
            </span>
            {u.id === state?.hostId && <span className="chip !h-7 !px-3 !text-xs">Host</span>}
          </div>
        ))}
      </div>

      <h3 className="mt-4 mb-1 text-xs font-bold tracking-wide text-faint uppercase">Invite friends</h3>
      <button className="btn btn-soft mb-2 w-full" onClick={async () => toast((await copyText(`${location.origin}/chill/${code}`)) ? 'Room link copied' : 'Couldn’t copy the link', 'info')}>
        <Icon name="link" size={19} /> Copy room link
      </button>
      <div className="grid gap-0.5">
        {sorted.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5 hover:bg-surface-2">
            <GroupAvatar c={c} meId={me.id} size={40} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <button className={`btn btn-sm ${sent.includes(c.id) ? 'btn-soft' : 'btn-primary'}`} disabled={sent.includes(c.id)} onClick={() => invite(c.id)}>
              {sent.includes(c.id) ? 'Sent' : 'Invite'}
            </button>
          </div>
        ))}
      </div>
      {isHost && (
        <button className="btn btn-danger mt-4 w-full" onClick={close}>
          <Icon name="door" size={19} /> Close the room for everyone
        </button>
      )}
    </Sheet>
  );
}

