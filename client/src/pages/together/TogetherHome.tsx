import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { CoinButton } from '../../components/CoinStore';
import { Icon, type IconName } from '../../components/Icon';
import { PrivateToggle } from '../../components/PrivateToggle';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import type { LiveChill, UnoCard } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { useTogether } from '../../stores/together';
import { GroupAvatar } from '../Chats';
import { UnoCardFace } from '../uno/UnoCard';
import { CreateTableSheet } from '../uno/UnoSheets';
import { CreateChipBoomSheet } from '../chipboom/CbSheets';
import { CreateGuessSheet } from '../guess/GnSheets';
import { CoverArt, LiveBars } from './parts';

export default function TogetherHome() {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const { rooms, booths, games, chipBoom, guess, loaded } = useTogether();
  const [opening, setOpening] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [chipping, setChipping] = useState(false);
  const [guessing, setGuessing] = useState(false);

  useEffect(() => {
    useTogether.getState().load().catch(() => {});
  }, []);

  const whose = (host: { id: number; displayName: string } | null) => (host?.id === me.id ? 'Your' : host ? `${host.displayName}’s` : 'A');
  const live = games.length + chipBoom.length + guess.length + rooms.length + booths.length;

  return (
    <div className="chill-bg relative h-full overflow-hidden">
      <div className="scroll-thin relative mx-auto h-full max-w-6xl overflow-x-hidden overflow-y-auto px-4 pb-32 md:px-10 md:pb-10">
        <header className="safe-top flex items-start gap-4 pt-6 md:pt-12">
          <div className="min-w-0 flex-1">
            <h1 className="text-[40px] leading-[1.05] font-bold md:text-[52px]">Together</h1>
            <p className="mt-1 text-[17px] text-muted md:text-lg">Pick something to do with friends</p>
          </div>
          <span className="mt-2">
            <CoinButton />
          </span>
        </header>

        <CardsHero onCreate={() => setDealing(true)} onJoin={() => setJoining(true)} />

        {/* The four activities share one card colour; only their buttons carry each one's accent. */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:mt-5 md:grid-cols-2 md:gap-5">
          <ActivityRow
            art={<ActivityIcon name="booth" />}
            title="Photobooth"
            text={['One strip, up to 4 friends', 'Snap one strip together, up to 4 friends']}
            cta={['Start', 'Start a booth']}
            onClick={() => nav('/booth')}
          />
          <ActivityRow
            art={<ActivityIcon name="music" />}
            title="Chill Room"
            text={['Songs in sync, chat together', 'Listen to full songs in sync and chat']}
            cta={['Open', 'Open a room']}
            onClick={() => setOpening(true)}
          />
          <ActivityRow
            art={<ActivityIcon name="bomb" />}
            title="Chip or Boom"
            text={['Find chips, dodge bombs', 'Blue grid vs pink grid. Find chips, dodge bombs']}
            cta={['Play', 'Play now']}
            onClick={() => setChipping(true)}
          />
          <ActivityRow
            art={<ActivityIcon name="guess" />}
            title="Guess the number"
            text={['Crack your friend’s number', 'Crack your friend’s secret number first']}
            cta={['Play', 'Play now']}
            onClick={() => setGuessing(true)}
          />
        </div>

        <h2 className="mt-8 mb-3 flex items-center gap-3 text-[26px] font-bold md:mt-10">
          Live now
          {live > 0 && (
            <span className="rounded-full bg-[#dff3e6] px-3 py-0.5 font-body text-[15px] font-bold text-[#2e7550] dark:bg-[#1f3b2c] dark:text-[#8fdcae]">{live} live</span>
          )}
        </h2>
        {loaded && live === 0 && (
          <p className="rounded-[24px] bg-surface/70 p-5 text-center text-muted">No one’s hanging out right now — open a table and invite friends.</p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => (
            <LiveRow
              key={g.code}
              art={g.host ? <Avatar user={g.host} size={58} /> : <Tile icon="cards" />}
              title={`${whose(g.host)} table`}
              text={`NivoTalk Cards · ${g.phase === 'lobby' ? `${g.players.length} of 4 seated` : 'playing now'}`}
              cta={g.phase === 'lobby' && g.players.length < 4 ? 'Join' : 'Watch'}
              onClick={() => nav(`/uno/${g.code}`)}
            />
          ))}
          {chipBoom.map((g) => (
            <LiveRow
              key={g.code}
              art={g.host ? <Avatar user={g.host} size={58} /> : <Tile icon="cards" />}
              title={`${whose(g.host)} Chip or Boom`}
              text={g.phase === 'lobby' ? `Chip or Boom · ${g.players.length} of 2 · ${g.stake} ${g.stake === 1 ? 'coin' : 'coins'} each` : 'Chip or Boom · playing now'}
              cta={g.phase === 'lobby' && g.players.length < 2 ? 'Join' : 'Watch'}
              onClick={() => nav(`/chipboom/${g.code}`)}
            />
          ))}
          {guess.map((g) => (
            <LiveRow
              key={g.code}
              art={g.host ? <Avatar user={g.host} size={58} /> : <Tile icon="cards" />}
              title={`${whose(g.host)} Guess the number`}
              text={g.phase === 'lobby' ? `Guess the number · ${g.players.length} of 4 · ${g.stake} ${g.stake === 1 ? 'coin' : 'coins'} each` : 'Guess the number · playing now'}
              cta={g.phase === 'lobby' && g.players.length < 4 ? 'Join' : 'Watch'}
              onClick={() => nav(`/guess/${g.code}`)}
            />
          ))}
          {rooms.map((r) => (
            <LiveRow
              key={r.code}
              art={<RoomArt r={r} />}
              title={r.nowPlaying?.title ?? `${whose(r.host)} Chill Room`}
              text={`Chill Room · ${r.listeners.length} listening`}
              cta="Join"
              onClick={() => nav(`/chill/${r.code}`)}
            />
          ))}
          {booths.map((b) => (
            <LiveRow
              key={b.code}
              art={<Tile icon="camera" />}
              title={`${whose(b.host)} Photobooth`}
              text={b.people.length >= 4 ? 'Photobooth · full' : `Photobooth · ${b.people.length} of 4 inside`}
              cta="Join"
              disabled={b.people.length >= 4}
              onClick={() => nav(`/booth/${b.code}`)}
            />
          ))}
        </div>
      </div>
      <OpenRoomSheet open={opening} onClose={() => setOpening(false)} />
      <CreateTableSheet open={dealing} onClose={() => setDealing(false)} />
      <JoinCodeSheet open={joining} onClose={() => setJoining(false)} />
      <CreateChipBoomSheet open={chipping} onClose={() => setChipping(false)} />
      <CreateGuessSheet open={guessing} onClose={() => setGuessing(false)} />
    </div>
  );
}

const FAN: Pick<UnoCard, 'color' | 'value'>[] = [
  { color: 'red', value: '7' },
  { color: 'blue', value: 'skip' },
  { color: 'yellow', value: 'draw2' },
  { color: 'green', value: 'reverse' },
  { color: 'wild', value: 'wild' },
];

/** Five cards fanned out, cut off by the edge of the hero card. */
function CardFan({ w }: { w: number }) {
  return (
    <div className="pointer-events-none flex items-end justify-center" aria-hidden="true">
      {FAN.map((c, i) => (
        <span
          key={i}
          className="shrink-0"
          style={{ marginLeft: i ? -w * 0.18 : 0, transform: `rotate(${(i - 2) * 6}deg) translateY(${Math.abs(i - 2) * 6}px)`, transformOrigin: '50% 100%', zIndex: i }}
        >
          <UnoCardFace card={c} w={w} className="drop-shadow-[0_6px_14px_rgba(90,111,208,0.18)]" />
        </span>
      ))}
    </div>
  );
}

/** The card game gets the big spot at the top. */
function CardsHero({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <section className="anim-rise relative mt-6 overflow-hidden rounded-[32px] bg-gradient-to-br from-[#fff7f9] via-[#fdeff4] to-[#eef1ff] shadow-[var(--shadow)] md:mt-8 md:bg-gradient-to-r md:from-surface md:via-surface md:to-[#fdeef3] dark:from-surface dark:via-surface dark:to-surface-2">
      {/* phone: cards across the top, cut off at the bottom */}
      <div className="h-[150px] overflow-hidden px-2 pt-5 md:hidden">
        <CardFan w={92} />
      </div>
      <div className="relative p-6 pt-4 md:max-w-[58%] md:p-10 md:pb-9">
        <span className="hidden rounded-full bg-primary-soft px-4 py-1.5 text-[14px] font-bold tracking-[0.12em] text-primary-strong uppercase md:inline-block">
          New · card game
        </span>
        <h2 className="flex flex-wrap items-center gap-3 text-[30px] leading-tight font-bold min-[400px]:text-[34px] md:mt-4 md:text-[46px]">
          NivoTalk Cards
          <span className="rounded-full bg-primary-soft px-3 py-0.5 font-body text-[14px] font-bold tracking-[0.12em] text-primary-strong uppercase md:hidden">New</span>
        </h2>
        <p className="mt-2 text-[17px] leading-snug text-muted md:text-[18px]">
          <span className="md:hidden">Match colors, play action cards and call your last card with up to 3 friends.</span>
          <span className="hidden md:inline">Match colors, play action cards and call your last card. A cozy card table for you and up to three friends.</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['2–4 players', 'About 10 min', 'Win coins'].map((c) => (
            <span key={c} className="rounded-full bg-white/70 px-3 py-1.5 text-[14px] font-semibold md:px-3.5 md:text-[15px] text-muted ring-1 ring-line dark:bg-surface-2">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:flex">
          <button className="btn h-14 bg-gradient-to-r from-[#5b6ad8] to-[#7a82e6] px-7 text-lg text-white shadow-[0_12px_24px_rgba(86,105,210,0.35)]" onClick={onCreate}>
            Create a table
          </button>
          <button className="btn h-14 bg-surface px-7 text-lg text-primary-strong ring-2 ring-line" onClick={onJoin}>
            Join with code
          </button>
        </div>
      </div>
      {/* desktop: cards on the right, sitting on the bottom edge */}
      <div className="absolute right-6 -bottom-16 hidden md:block lg:right-12">
        <CardFan w={124} />
      </div>
    </section>
  );
}

function ActivityRow(p: {
  art: ReactNode;
  title: string;
  text: [string, string];
  cta: [string, string];
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="anim-rise flex min-w-0 items-center gap-3 rounded-[28px] bg-surface p-3.5 shadow-[var(--shadow-sm)] min-[400px]:gap-4 min-[400px]:p-4 md:gap-5 md:p-6">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] bg-primary-soft text-primary-strong md:h-[68px] md:w-[68px]">{p.art}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[20px] leading-tight font-bold break-words min-[400px]:text-[22px] md:text-[26px]">{p.title}</span>
        <span className="block leading-snug text-muted">
          <span className="md:hidden">{p.text[0]}</span>
          <span className="hidden md:inline">{p.text[1]}</span>
        </span>
      </span>
      {/* One button style for every activity, so the row reads as a set. */}
      <button
        className="btn h-12 w-[84px] shrink-0 bg-gradient-to-r from-[#5b6ad8] to-[#7a82e6] px-0 text-[16px] text-white shadow-[0_10px_22px_rgba(86,105,210,0.35)] disabled:opacity-55 disabled:shadow-none min-[400px]:w-[92px] md:h-14 md:w-[156px] md:text-lg"
        onClick={p.onClick}
        disabled={p.disabled}
      >
        <span className="md:hidden">{p.cta[0]}</span>
        <span className="hidden md:inline">{p.cta[1]}</span>
      </button>
    </section>
  );
}

/**
 * The activity line icons (public/games/icons) used as masks, so they're painted in the theme colour
 * and follow dark mode without changing the drawings.
 */
function ActivityIcon({ name }: { name: 'bomb' | 'music' | 'booth' | 'guess' }) {
  const url = `url(/games/icons/${name}.png)`;
  return (
    <span
      className="block h-9 w-9 md:h-11 md:w-11"
      style={{ backgroundColor: 'currentColor', WebkitMaskImage: url, maskImage: url, WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' }}
      aria-hidden="true"
    />
  );
}

function Tile({ icon }: { icon: IconName }) {
  return (
    <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-primary-soft text-primary-strong">
      <Icon name={icon} size={26} />
    </span>
  );
}

function RoomArt({ r }: { r: LiveChill }) {
  if (!r.nowPlaying?.artwork)
    return (
      <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-[#dce9ff] text-[#2f6fd6] dark:bg-primary-soft dark:text-primary-strong">
        {r.nowPlaying?.playing ? <LiveBars className="!h-5" /> : <Icon name="music" size={26} />}
      </span>
    );
  return <CoverArt src={r.nowPlaying.artwork} seed={r.code} className="h-[58px] w-[58px]" rounded="rounded-full" />;
}

function LiveRow(p: { art: ReactNode; title: string; text: string; cta: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[26px] bg-surface p-3.5 pr-3.5 shadow-[var(--shadow-sm)] min-[400px]:gap-3.5 min-[400px]:pr-4">
      <span className="shrink-0">{p.art}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[18px] font-semibold">{p.title}</span>
        <span className="block truncate text-muted">{p.text}</span>
      </span>
      <button
        className="h-11 shrink-0 rounded-full bg-surface px-5 font-display text-[16px] min-[400px]:h-12 min-[400px]:px-6 min-[400px]:text-[17px] font-semibold text-primary-strong ring-2 ring-line transition hover:bg-primary-soft active:scale-95 disabled:opacity-50"
        onClick={p.onClick}
        disabled={p.disabled}
      >
        {p.cta}
      </button>
    </div>
  );
}

/** Type the 6-character code a friend shared. */
function JoinCodeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return toast('Table codes have 6 letters and numbers', 'error');
    setBusy(true);
    try {
      // The code could belong to any of the games.
      const paths = ['uno', 'chipboom', 'guess'];
      const tries = await Promise.allSettled(paths.map((p) => api<{ phase: string }>(`/${p}/${c}`)));
      const i = tries.findIndex((t) => t.status === 'fulfilled');
      const found = i >= 0 ? { t: (tries[i] as PromiseFulfilledResult<{ phase: string }>).value, path: paths[i] } : null;
      if (!found) throw (tries[0] as PromiseRejectedResult).reason;
      if (found.t.phase === 'closed' || found.t.phase === 'finished') return toast('That table has already closed', 'error');
      onClose();
      setCode('');
      nav(`/${found.path}/${c}`);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Join with code">
      <form onSubmit={submit}>
        <p className="text-sm text-muted">Ask the host for the code shown at the top of their table.</p>
        <input
          className="mt-4 h-16 w-full rounded-[20px] bg-surface-2 text-center font-display text-[30px] font-bold tracking-[0.35em] uppercase ring-2 ring-line outline-none focus:ring-primary"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6))}
          placeholder="ABC234"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Table code"
        />
        <button className="btn btn-primary mt-4 h-14 w-full text-lg" disabled={busy || code.length !== 6}>
          {busy ? 'Finding table…' : 'Join table'}
        </button>
      </form>
    </Sheet>
  );
}

/** Open a Chill Room on its own (share the link) or for one of your chats (everyone there gets an invite). */
export function OpenRoomSheet({ open, onClose, conversationId }: { open: boolean; onClose: () => void; conversationId?: number }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [busy, setBusy] = useState<number | 'solo' | null>(null);
  const [isPrivate, setPrivate] = useState(false);

  async function start(cid?: number) {
    setBusy(cid ?? 'solo');
    try {
      const { room } = await api<{ room: { code: string } }>('/chill', { body: { ...(cid ? { conversationId: cid } : {}), private: isPrivate } });
      onClose();
      nav(`/chill/${room.code}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const sorted = conversationId ? [...conversations].sort((a) => (a.id === conversationId ? -1 : 0)) : conversations;

  return (
    <Sheet open={open} onClose={onClose} title="Open a Chill Room">
      <p className="text-sm text-muted">Pick a chat and everyone in it gets an invite. Songs play in full, in sync, for the whole room.</p>
      <div className="mt-3">
        <PrivateToggle on={isPrivate} onChange={setPrivate} />
      </div>
      <div className="mt-3 grid gap-0.5">
        {sorted.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5 hover:bg-surface-2">
            <GroupAvatar c={c} meId={me.id} size={42} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => start(c.id)}>
              {busy === c.id ? 'Opening…' : 'Open'}
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-soft mt-3 w-full" disabled={busy !== null} onClick={() => start()}>
        <Icon name="link" size={19} /> {busy === 'solo' ? 'Opening…' : 'Just open a room — I’ll share the link'}
      </button>
    </Sheet>
  );
}
