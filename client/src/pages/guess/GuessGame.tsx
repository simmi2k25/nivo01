import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { CoinButton } from '../../components/CoinStore';
import { CommentBubbles, CommentButton } from '../../components/GameComments';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { MicBadge, useTableVoice, VoiceButton, type Voice } from '../../components/VoiceChat';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { publicOrigin } from '../../lib/native';
import { copyText } from '../../lib/share';
import type { GnGuess, GnHint, GnPlayer, GnState, User } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { GroupAvatar } from '../Chats';
import { Coin } from '../uno/UnoSheets';
import { QuestionTile } from './art';
import { gn, joinGn, leaveGn, serverNow, useGn } from './gnStore';

const coins = (n: number) => `${n} ${n === 1 ? 'coin' : 'coins'}`;
const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const AMBER = 'bg-gradient-to-b from-[#f6b33d] to-[#e58a00]';

const HINT: Record<GnHint, { text: string; sub: string; icon: string; tone: string }> = {
  low: { text: 'Too low!', sub: 'The secret number is higher', icon: '⬆️', tone: 'bg-[#e3edff] text-[#2b5aa6] dark:bg-[#1c2748] dark:text-[#a9c4ff]' },
  high: { text: 'Too high!', sub: 'The secret number is lower', icon: '⬇️', tone: 'bg-[#ffe7ee] text-[#b3315e] dark:bg-[#361f30] dark:text-[#ffb3cb]' },
  correct: { text: 'Correct!', sub: 'You cracked it', icon: '🎉', tone: 'bg-[#dff3e6] text-[#2e7550] dark:bg-[#1f3b2c] dark:text-[#8fdcae]' },
};

function useMedia(q: string) {
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setOn(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [q]);
  return on;
}

function useTick(on: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

export default function GuessGamePage() {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const status = useGn((s) => s.status);
  const error = useGn((s) => s.error);
  const state = useGn((s) => s.state);
  const me = useAuth((s) => s.user)!;
  const seated = !!state?.players.some((p) => p.user.id === me.id);
  const voice = useTableVoice(seated && state?.phase !== 'finished' ? `gn:${code}` : null);

  useEffect(() => {
    joinGn(code);
    return () => leaveGn();
  }, [code]);

  return (
    <div className="chill-bg relative h-full overflow-hidden">
      {state && (state.phase === 'lobby' ? <Lobby state={state} voice={voice} /> : <Game state={state} voice={voice} />)}
      {state && <TableComments lobby={state.phase === 'lobby'} />}
      {status !== 'live' && (
        <div className="chill-bg absolute inset-0 z-30 grid place-items-center p-8 text-center">
          {status === 'joining' ? (
            <div className="grid justify-items-center gap-3">
              <span className="anim-spin h-9 w-9 rounded-full border-[3px] border-primary-soft border-t-primary" />
              <p className="font-bold text-muted">Shuffling the numbers…</p>
            </div>
          ) : (
            <div className="card anim-rise grid max-w-sm justify-items-center gap-3 p-7">
              <QuestionTile size={64} />
              <h2 className="text-xl font-bold">{status === 'closed' ? 'This table has closed' : 'Couldn’t open the table'}</h2>
              <p className="text-sm text-muted">{error}</p>
              <div className="flex gap-2">
                {status === 'error' && (
                  <button className="btn btn-soft btn-sm" onClick={() => joinGn(code)}>
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

function TableComments({ lobby }: { lobby: boolean }) {
  const me = useAuth((s) => s.user)!;
  const comments = useGn((s) => s.comments);
  return <CommentBubbles comments={comments} meId={me.id} className={lobby ? 'bottom-28 left-3 md:left-[104px]' : 'bottom-6 left-3 md:left-[104px]'} />;
}

function Header({ title, sub, onBack, right }: { title: string; sub?: ReactNode; onBack: () => void; right: ReactNode }) {
  return (
    <header className="safe-top shrink-0">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 pt-3 md:gap-3 md:px-6 md:pt-6">
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-primary-strong shadow-[var(--shadow-sm)] transition active:scale-95" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-[16px] leading-tight font-bold min-[400px]:text-[18px] md:text-[26px]">{title}</h1>
          {sub && <p className="truncate text-xs text-muted md:text-sm">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:gap-2.5">{right}</div>
      </div>
    </header>
  );
}

// ================================================================ lobby

function Lobby({ state, voice }: { state: GnState; voice: Voice }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const wide = useMedia('(min-width: 768px)');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const mine = state.players.find((p) => p.user.id === me.id) ?? null;
  const isHost = state.hostId === me.id;
  const [draft, setDraft] = useState(state.you?.secret != null ? String(state.you.secret) : '');
  const [peek, setPeek] = useState(false);
  const value = Number(draft);
  const valid = draft !== '' && Number.isInteger(value) && value >= 1 && value <= state.max;
  const allReady = state.players.length >= 2 && state.players.every((p) => p.ready);
  const full = state.players.length >= state.maxPlayers;

  useEffect(() => {
    if (state.you?.secret != null && mine?.ready) setDraft(String(state.you.secret));
  }, [state.you?.secret, mine?.ready]);

  async function run(fn: () => Promise<string | null>) {
    if (busy) return null;
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) toast(err, 'error');
    return err;
  }

  async function lockIn() {
    if (!valid) return toast(`Pick a number from 1 to ${state.max}`, 'error');
    await run(async () => (value !== state.you?.secret ? ((await gn.secret(value)) ?? (await gn.ready())) : gn.ready()));
  }

  function random() {
    setDraft(String(1 + Math.floor(Math.random() * state.max)));
    setPeek(true);
  }

  async function leaveTable() {
    if (isHost) {
      if (!confirm('Close this table? Any stakes are refunded.')) return;
      await gn.close().catch((e) => toast(errorText(e), 'error'));
    } else if (mine) {
      await gn.leave().catch((e) => toast(errorText(e), 'error'));
    }
    nav('/together');
  }

  const primary = !mine ? (
    <button className={`btn ${AMBER} h-14 flex-1 text-lg text-white shadow-[0_12px_26px_rgba(229,138,0,0.35)] md:min-w-[300px] md:flex-none`} disabled={full || busy} onClick={() => run(gn.sit)}>
      {full ? 'The table is full' : 'Take a seat'}
    </button>
  ) : !mine.ready ? (
    <button className={`btn ${AMBER} h-14 flex-1 text-lg text-white shadow-[0_12px_26px_rgba(229,138,0,0.35)] md:min-w-[300px] md:flex-none`} disabled={!valid || busy} onClick={lockIn}>
      {busy ? 'Locking in…' : 'Lock in · Ready'}
      {wide && (
        <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-sm">
          <Coin size={16} /> {state.stake}
        </span>
      )}
    </button>
  ) : isHost ? (
    <button className={`btn ${AMBER} h-14 flex-1 text-lg text-white shadow-[0_12px_26px_rgba(229,138,0,0.35)] md:min-w-[300px] md:flex-none`} disabled={!allReady || busy} onClick={() => run(gn.start)}>
      {allReady ? 'Start the game' : state.players.length < 2 ? 'Waiting for a friend…' : 'Waiting for everyone…'}
    </button>
  ) : (
    <button className={`btn ${AMBER} h-14 flex-1 text-lg text-white opacity-90 md:min-w-[300px] md:flex-none`} disabled>
      <span className="anim-spin h-4 w-4 rounded-full border-2 border-white/40 border-t-white" />
      {allReady ? 'Waiting for the host' : 'Waiting for everyone'}
    </button>
  );
  const secondary = mine?.ready && (
    <button className="btn h-14 bg-surface px-6 text-lg text-primary-strong ring-2 ring-line" disabled={busy} onClick={() => run(gn.unready)}>
      Not ready
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Guess the number"
        sub={`Code ${state.code}`}
        onBack={() => nav('/together')}
        right={
          <>
            {mine && <VoiceButton voice={voice} />}
            <CommentButton onSend={gn.say} />
            {(isHost || mine) && !full && (
              <button className="grid h-10 w-10 place-items-center rounded-full bg-surface text-primary-strong shadow-[var(--shadow-sm)] md:h-12 md:w-12" onClick={() => setInvite(true)} aria-label="Invite friends">
                <Icon name="userPlus" size={19} />
              </button>
            )}
            {wide && <CoinButton />}
          </>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 pb-6">
          <section className="anim-rise mt-4 text-center">
            <div className="flex justify-center">
              <QuestionTile size={wide ? 84 : 68} />
            </div>
            <h2 className="mt-3 text-[30px] leading-tight font-bold md:text-[44px]">Hide a number. Crack theirs.</h2>
            <p className="mt-1 text-muted md:text-lg">Everyone picks a secret number — fewest tries to crack a friend’s wins.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#fff4d6] px-3.5 py-1.5 text-sm font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 dark:bg-[#3a2f12] dark:text-[#ffd36b]">
                <Coin size={18} /> {coins(state.stake)} each · winner takes the pot
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-sm font-bold text-muted ring-1 ring-line">Numbers 1–{state.max}</span>
            </div>
          </section>

          {mine && (
            <section className="anim-rise mt-5 rounded-[30px] bg-surface p-5 shadow-[var(--shadow-sm)] md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex min-w-0 items-center gap-2 font-display text-[17px] font-bold md:text-[19px]">
                  <Icon name="lock" size={18} className="text-[#e58a00]" /> Your secret number
                </h3>
                {mine.ready ? (
                  <span className="rounded-full bg-[#dff3e6] px-3 py-1 text-sm font-bold text-[#2e7550] dark:bg-[#1f3b2c] dark:text-[#8fdcae]">Locked in ✓</span>
                ) : (
                  <button className="shrink-0 rounded-full bg-[#fff1cf] px-3 py-1.5 text-sm font-bold whitespace-nowrap text-[#a35f00] transition active:scale-95 dark:bg-[#3a2f12] dark:text-[#ffd36b]" onClick={random}>
                    🎲 Random
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  className="game-compose h-16 min-w-0 flex-1 rounded-[20px] bg-surface-2 text-center font-display text-[34px] font-bold tracking-[0.12em] ring-2 ring-line outline-none focus:ring-[#f2b33d] disabled:opacity-80"
                  type={peek || !mine.ready ? 'text' : 'password'}
                  inputMode="numeric"
                  value={draft}
                  disabled={mine.ready}
                  onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, String(state.max).length))}
                  onKeyDown={(e) => e.key === 'Enter' && lockIn()}
                  placeholder={`1–${state.max}`}
                  aria-label="Your secret number"
                />
                <button className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-surface-2 text-muted ring-2 ring-line" onClick={() => setPeek((v) => !v)} aria-label={peek ? 'Hide number' : 'Show number'}>
                  <Icon name={peek ? 'eyeOff' : 'eye'} />
                </button>
              </div>
              <p className="mt-2 text-sm text-muted">
                {mine.ready ? 'Nobody else can see it — the app checks every guess against it.' : `Pick any whole number from 1 to ${state.max}. Keep it to yourself!`}
              </p>
            </section>
          )}

          <section className="anim-rise mt-5">
            <h3 className="mb-2 flex items-baseline justify-between font-display text-[19px] font-bold">
              At the table <span className="font-body text-sm text-muted">{state.players.length}/{state.maxPlayers}</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: state.maxPlayers }, (_, i) => {
                const p = state.players[i];
                if (!p)
                  return (
                    <button
                      key={i}
                      className="grid min-h-[132px] place-items-center rounded-[24px] border-2 border-dashed border-line text-faint transition enabled:hover:border-[#f2b33d] enabled:hover:text-[#a35f00]"
                      disabled={!!mine || busy}
                      onClick={() => run(gn.sit)}
                    >
                      <span className="grid justify-items-center gap-1 font-bold">
                        <Icon name="plus" /> Open seat
                      </span>
                    </button>
                  );
                return (
                  <div key={p.user.id} className="relative grid min-h-[132px] justify-items-center gap-1.5 rounded-[24px] bg-surface p-3 text-center shadow-[var(--shadow-sm)]">
                    {p.user.id === state.hostId && <span className="absolute top-2 left-3 text-lg" title="Host">👑</span>}
                    <span className="absolute top-2.5 right-2.5">
                      <MicBadge voice={voice} userId={p.user.id} />
                    </span>
                    <Avatar user={p.user as User} size={56} />
                    <span className="max-w-full truncate font-bold">{p.user.id === me.id ? 'You' : p.user.displayName}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        p.ready ? 'bg-[#dff3e6] text-[#2e7550] dark:bg-[#1f3b2c] dark:text-[#8fdcae]' : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {p.ready ? 'Ready ✓' : 'Picking a number…'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <HowToPlay max={state.max} />

          {wide && (
            <div className="mt-6 flex justify-center gap-3">
              {secondary}
              {primary}
            </div>
          )}
          {(isHost || mine) && (
            <p className="mt-4 text-center">
              <button className="text-sm font-bold text-muted underline-offset-4 hover:underline" onClick={leaveTable}>
                {isHost ? 'Close the table' : 'Leave the table'}
              </button>
            </p>
          )}
        </div>
      </div>
      {!wide && (
        <div className="safe-bottom shrink-0 border-t border-line bg-surface/90 px-4 pt-3 pb-3 backdrop-blur">
          <div className="flex gap-3">
            {secondary}
            {primary}
          </div>
        </div>
      )}
      <InviteSheet open={invite} onClose={() => setInvite(false)} code={state.code} stake={state.stake} />
    </div>
  );
}

function HowToPlay({ max }: { max: number }) {
  const steps: [string, string][] = [
    ['Hide a number', `Everyone picks a secret number from 1 to ${max}.`],
    ['Crack a friend’s', 'You guess the next player’s number — with two of you, each other’s.'],
    ['Read the hint', '⬆️ Too low, ⬇️ too high, or 🎉 correct — the app answers, so nobody can fib.'],
    ['Keep going', 'Narrow it down until you hit it. Everyone races at the same time.'],
    ['Fewest tries wins', 'Ties go to whoever cracked it first. Nobody cracks it in 3 minutes? Stakes come back.'],
  ];
  return (
    <section className="anim-rise mt-5 rounded-[30px] bg-surface p-5 shadow-[var(--shadow-sm)] md:p-6">
      <h3 className="font-display text-[22px] font-bold">How to play</h3>
      <ol className="mt-3 grid gap-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff1cf] font-display font-bold text-[#a35f00] dark:bg-[#3a2f12] dark:text-[#ffd36b]">{i + 1}</span>
            <span className="pt-1 leading-snug">
              <b className="font-display font-bold">{t}.</b> <span className="text-muted">{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InviteSheet({ open, onClose, code, stake }: { open: boolean; onClose: () => void; code: string; stake: number }) {
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [sent, setSent] = useState<number[]>([]);
  const link = `${publicOrigin()}/guess/${code}`;
  const text = `Play Guess the Number with me 🔢 · ${coins(stake)} each\nTable code: ${code}`;
  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <div className="rounded-2xl bg-[#fff4d6] p-4 text-center dark:bg-[#3a2f12]">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">Table code</p>
        <p className="font-display text-4xl font-bold tracking-[0.2em] text-[#a35f00] dark:text-[#ffd36b]">{code}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-soft btn-sm" onClick={async () => toast((await copyText(`${text}\n${link}`)) ? 'Invite copied' : link)}>
          <Icon name="link" size={17} /> Copy invite
        </button>
        <button
          className="btn btn-soft btn-sm"
          onClick={() => (navigator.share ? navigator.share({ title: 'Guess the Number', text, url: link }).catch(() => {}) : copyText(`${text}\n${link}`).then(() => toast('Invite copied')))}
        >
          <Icon name="share" size={17} /> Share
        </button>
      </div>
      <p className="mt-4 mb-1 text-xs font-bold tracking-wide text-faint uppercase">Send to a chat</p>
      {conversations.length === 0 && <p className="py-3 text-sm text-muted">No chats yet.</p>}
      <div className="grid gap-0.5">
        {conversations.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5 hover:bg-surface-2">
            <GroupAvatar c={c} meId={me.id} size={40} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <button
              className={`btn btn-sm ${sent.includes(c.id) ? 'btn-soft' : 'btn-primary'}`}
              disabled={sent.includes(c.id)}
              onClick={() =>
                api(`/guess/${code}/invite`, { body: { conversationId: c.id } })
                  .then(() => setSent((s) => [...s, c.id]))
                  .catch((e) => toast(errorText(e), 'error'))
              }
            >
              {sent.includes(c.id) ? 'Sent' : 'Invite'}
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ================================================================ game

/** What the hints so far leave open: one above the highest "too low", one below the lowest "too high". */
function windowOf(guesses: GnGuess[], max: number) {
  let lo = 1;
  let hi = max;
  for (const g of guesses) {
    if (g.hint === 'low') lo = Math.max(lo, g.value + 1);
    if (g.hint === 'high') hi = Math.min(hi, g.value - 1);
    if (g.hint === 'correct') lo = hi = g.value;
  }
  return { lo, hi };
}

function Game({ state, voice }: { state: GnState; voice: Voice }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const wide = useMedia('(min-width: 900px)');
  const mine = state.players.find((p) => p.user.id === me.id) ?? null;
  const byId = useMemo(() => new Map(state.players.map((p) => [p.user.id, p])), [state.players]);
  const target = mine?.targetId != null ? byId.get(mine.targetId) : null;
  const hunter = mine ? state.players.find((p) => p.targetId === me.id) : null;
  const playing = state.phase === 'playing';
  useTick(playing);
  const now = serverNow();
  const intro = playing && state.startsAt != null && now < state.startsAt;
  const left = state.endsAt ? state.endsAt - now : 0;
  const guesses = state.you?.guesses ?? [];
  const solved = !!mine?.solvedAt;
  const canGuess = playing && !!mine && !mine.out && !solved && !intro;

  async function leave() {
    if (!mine || !playing || solved || mine.out) return nav('/together');
    if (!confirm('Leave the game? You won’t be able to win this one.')) return;
    await gn.leave().catch((e) => toast(errorText(e), 'error'));
    nav('/together');
  }

  const sub = `1–${state.max} · ${coins(state.stake)} each`;
  const side = (
    <div className="grid content-start gap-4">
      <Players state={state} meId={me.id} byId={byId} voice={voice} />
      {mine && state.you?.secret != null && <YourNumber secret={state.you.secret} hunter={hunter ?? null} guesses={state.you.onMine} meId={me.id} />}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Guess the number"
        sub={sub}
        onBack={leave}
        right={
          <>
            <PotBadge pot={state.pot} />
            {mine && <VoiceButton voice={voice} />}
            <CommentButton onSend={gn.say} />
          </>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto max-w-5xl px-3 pt-4 pb-8 md:px-6 ${wide ? 'grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6' : 'grid gap-4'}`}>
          <div className="grid gap-4">
            <Clock left={left} intro={intro} startsIn={state.startsAt ? state.startsAt - now : 0} playing={playing} />
            {mine && target ? (
              <Cracker state={state} target={target} guesses={guesses} solved={solved} canGuess={canGuess} out={mine.out} />
            ) : (
              <p className="rounded-[26px] bg-surface p-5 text-center text-muted shadow-[var(--shadow-sm)]">You’re watching — see who cracks their number first.</p>
            )}
          </div>
          {side}
        </div>
      </div>
      {intro && <Countdown ms={state.startsAt! - now} />}
      {state.phase === 'finished' && <Finished state={state} meId={me.id} />}
    </div>
  );
}

function PotBadge({ pot }: { pot: number }) {
  return (
    <span className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-[#fff4d6] px-2 text-sm font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 md:h-12 md:px-4 md:text-base dark:bg-[#3a2f12] dark:text-[#ffd36b]">
      <Coin size={20} />
      <span className="tabular-nums">{pot}</span>
    </span>
  );
}

function Clock({ left, intro, startsIn, playing }: { left: number; intro: boolean; startsIn: number; playing: boolean }) {
  const total = 3 * 60_000;
  const frac = intro ? 1 : Math.max(0, Math.min(1, left / total));
  const low = playing && !intro && left < 30_000;
  return (
    <div className="flex items-center gap-3 rounded-full bg-surface px-4 py-2.5 shadow-[var(--shadow-sm)]">
      <Icon name="clock" size={18} className={low ? 'text-danger' : 'text-muted'} />
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full transition-[width] duration-300 ease-linear ${low ? 'bg-danger' : AMBER}`} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className={`w-12 text-right font-display text-lg font-bold tabular-nums ${low ? 'text-danger' : ''}`}>{intro ? fmtClock(startsIn) : playing ? fmtClock(left) : '0:00'}</span>
    </div>
  );
}

function Countdown({ ms }: { ms: number }) {
  const n = Math.max(1, Math.ceil(ms / 1000));
  return (
    <div className="anim-fade pointer-events-none fixed inset-0 z-40 grid place-items-center bg-[#1b2148]/25 backdrop-blur-[2px]">
      <span key={n} className="anim-pop font-display text-[120px] leading-none font-bold text-white drop-shadow-[0_8px_24px_rgba(229,138,0,0.6)]">
        {n}
      </span>
    </div>
  );
}

/** The heart of the game: whose number, what's still possible, the keypad and your guesses so far. */
function Cracker({ state, target, guesses, solved, canGuess, out }: { state: GnState; target: GnPlayer; guesses: GnGuess[]; solved: boolean; canGuess: boolean; out: boolean }) {
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const { lo, hi } = windowOf(guesses, state.max);
  const last = guesses.at(-1);
  const digits = String(state.max).length;

  async function submit() {
    const v = Number(entry);
    if (!entry || busy || !canGuess) return;
    if (v < 1 || v > state.max) return toast(`Guess from 1 to ${state.max}`, 'error');
    setBusy(true);
    const err = await gn.guess(v);
    setBusy(false);
    if (err) return toast(err, 'error');
    setEntry('');
  }
  const press = (k: string) => {
    if (!canGuess) return;
    if (k === '⌫') return setEntry((e) => e.slice(0, -1));
    setEntry((e) => (e.length >= digits ? e : (e + k).replace(/^0+/, '')));
  };

  // A real keyboard works too: digits, Backspace and Enter.
  const keys = useRef({ press, submit });
  keys.current = { press, submit };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      if (/^\d$/.test(e.key)) keys.current.press(e.key);
      else if (e.key === 'Backspace') keys.current.press('⌫');
      else if (e.key === 'Enter') keys.current.submit();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    if (last?.hint === 'correct') navigator.vibrate?.([40, 30, 80]);
  }, [last]);

  const pct = (n: number) => ((n - 1) / Math.max(1, state.max - 1)) * 100;

  return (
    <section className="grid gap-4 rounded-[32px] bg-surface p-4 shadow-[var(--shadow-sm)] md:p-6">
      <div className="flex items-center gap-3">
        <Avatar user={target.user as User} size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-muted">Cracking</p>
          <p className="truncate font-display text-[22px] leading-tight font-bold">{target.user.displayName}’s number</p>
        </div>
        <span className="rounded-full bg-surface-2 px-3 py-1.5 font-display font-bold tabular-nums">{tries(guesses.length)}</span>
      </div>

      {/* What's still possible: the window narrows with every hint. */}
      <div>
        <div className="flex items-baseline justify-between text-sm font-bold text-muted">
          <span>1</span>
          <span className="font-display text-[18px] text-ink">{solved ? `It was ${lo}` : lo === hi ? `It must be ${lo}` : `Between ${lo} and ${hi}`}</span>
          <span>{state.max}</span>
        </div>
        <div className="relative mt-2 h-4 rounded-full bg-surface-2 ring-1 ring-line">
          <div className={`absolute inset-y-0 rounded-full ${AMBER} transition-all duration-500 ease-out`} style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%`, minWidth: 8 }} />
          {guesses.map((g, i) => (
            <span
              key={i}
              className={`absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${g.hint === 'low' ? 'bg-[#4a7fe0]' : g.hint === 'high' ? 'bg-[#e0688f]' : 'bg-[#2fbf71]'}`}
              style={{ left: `${pct(g.value)}%` }}
              title={String(g.value)}
            />
          ))}
        </div>
      </div>

      {last && (
        <div key={guesses.length} className={`anim-pop flex items-center gap-3 rounded-[22px] px-4 py-3 ${HINT[last.hint].tone}`}>
          <span className="text-[30px] leading-none">{HINT[last.hint].icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[22px] leading-tight font-bold">
              {last.value} — {HINT[last.hint].text}
            </span>
            <span className="block text-sm font-semibold opacity-80">{last.hint === 'correct' ? `Cracked in ${tries(guesses.length)}` : HINT[last.hint].sub}</span>
          </span>
        </div>
      )}

      {solved ? (
        <p className="rounded-[22px] bg-surface-2 p-4 text-center font-bold text-muted">You’re done — waiting for the others to crack theirs…</p>
      ) : out ? (
        <p className="rounded-[22px] bg-surface-2 p-4 text-center font-bold text-muted">You left this game.</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex h-16 items-center justify-center rounded-[22px] bg-surface-2 font-display text-[40px] font-bold tracking-[0.1em] tabular-nums ring-2 ring-line">
            {entry || <span className="text-[22px] tracking-normal text-faint">{canGuess ? 'Type a guess' : 'Get ready…'}</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k) => (
              <button
                key={k}
                className="h-14 rounded-[18px] bg-surface-2 font-display text-[24px] font-bold shadow-[inset_0_-3px_0_rgba(0,0,0,0.06)] transition active:scale-95 active:bg-line disabled:opacity-40"
                onClick={() => press(k)}
                disabled={!canGuess}
                aria-label={k === '⌫' ? 'Delete' : k}
              >
                {k}
              </button>
            ))}
            <button className={`h-14 rounded-[18px] ${AMBER} font-display text-[20px] font-bold text-white shadow-[0_8px_18px_rgba(229,138,0,0.35)] transition active:scale-95 disabled:opacity-40`} onClick={submit} disabled={!canGuess || !entry || busy}>
              Guess
            </button>
          </div>
        </div>
      )}

      {guesses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...guesses].reverse().map((g, i) => (
            <span key={guesses.length - i} className={`rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${HINT[g.hint].tone}`}>
              {g.value} {HINT[g.hint].icon}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Players({ state, meId, byId, voice }: { state: GnState; meId: number; byId: Map<number, GnPlayer>; voice: Voice }) {
  return (
    <section className="rounded-[28px] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h3 className="mb-2 font-display text-[18px] font-bold">Race</h3>
      <ul className="grid gap-2">
        {state.players.map((p) => {
          const target = p.targetId != null ? byId.get(p.targetId) : null;
          const done = !!p.solvedAt;
          return (
            <li key={p.user.id} className={`flex items-center gap-3 rounded-2xl p-2 ${done ? 'bg-[#dff3e6]/70 dark:bg-[#1f3b2c]' : ''}`}>
              <Avatar user={p.user as User} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="truncate">{p.user.id === meId ? 'You' : p.user.displayName}</span>
                  <MicBadge voice={voice} userId={p.user.id} />
                </span>
                <span className="block truncate text-xs text-muted">
                  {p.out ? 'Left the game' : done ? `Cracked ${target?.user.id === meId ? 'your' : `${target?.user.displayName ?? 'their'}’s`} number` : `Cracking ${target?.user.id === meId ? 'your' : `${target?.user.displayName ?? 'a'}’s`} number`}
                </span>
              </span>
              <span key={p.attempts} className={`anim-pop shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${done ? 'bg-[#2fbf71] text-white' : 'bg-surface-2'}`}>
                {done ? `✓ ${p.attempts}` : p.attempts}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function YourNumber({ secret, hunter, guesses, meId }: { secret: number; hunter: GnPlayer | null; guesses: GnGuess[]; meId: number }) {
  const [peek, setPeek] = useState(false);
  return (
    <section className="rounded-[28px] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff1cf] text-[#a35f00] dark:bg-[#3a2f12] dark:text-[#ffd36b]">
          <Icon name="lock" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-muted">Your number</span>
          <span className="block font-display text-[26px] leading-tight font-bold tabular-nums">{peek ? secret : '••'}</span>
        </span>
        <button className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted" onClick={() => setPeek((v) => !v)} aria-label={peek ? 'Hide your number' : 'Show your number'}>
          <Icon name={peek ? 'eyeOff' : 'eye'} size={19} />
        </button>
      </div>
      {hunter && hunter.user.id !== meId && (
        <>
          <p className="mt-3 text-sm font-bold text-muted">
            {hunter.user.displayName} {guesses.length ? `has tried ${tries(guesses.length)}` : 'hasn’t guessed yet'}
          </p>
          {guesses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...guesses].reverse().map((g, i) => (
                <span key={guesses.length - i} className={`rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${HINT[g.hint].tone}`}>
                  {g.value} {HINT[g.hint].icon}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ================================================================ the end

function Finished({ state, meId }: { state: GnState; meId: number }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const mine = state.players.find((p) => p.user.id === meId);
  const won = state.winnerId === meId;
  const winner = state.players.find((p) => p.user.id === state.winnerId);
  const draw = state.winnerId == null;
  const ranked = [...state.players].sort((a, b) => {
    const sa = a.solvedAt ? 0 : a.out ? 2 : 1;
    const sb = b.solvedAt ? 0 : b.out ? 2 : 1;
    return sa - sb || (a.solvedAt && b.solvedAt ? a.attempts - b.attempts || a.solvedAt - b.solvedAt : 0);
  });

  async function again() {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/guess', { body: { stake: state.stake, max: state.max, ...(state.conversationId ? { conversationId: state.conversationId } : {}) } });
      nav(`/guess/${code}`, { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="anim-fade fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[#1b2148]/45 p-5 backdrop-blur-sm">
      <div className="anim-rise card w-full max-w-sm p-6 text-center">
        <div className="text-[56px] leading-none">{draw ? '🤝' : won ? '🏆' : '🎉'}</div>
        <h2 className="mt-2 text-[28px] leading-tight font-bold">{draw ? 'Nobody cracked it' : won ? 'You won!' : `${winner?.user.displayName ?? 'Someone'} won`}</h2>
        <p className="mt-1 text-muted">{draw ? 'Everyone’s stake has gone back to them' : winner ? `Cracked it in ${tries(winner.attempts)}` : ''}</p>
        {won && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#fff4d6] px-4 py-2 font-display text-[22px] font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 dark:bg-[#3a2f12] dark:text-[#ffd36b]">
            <Coin size={26} /> +{state.payout}
          </p>
        )}
        <ol className="mt-4 grid gap-1.5 text-left">
          {ranked.map((p, i) => (
            <li key={p.user.id} className={`flex items-center gap-3 rounded-2xl p-2 ${p.user.id === state.winnerId ? 'bg-[#fff4d6] dark:bg-[#3a2f12]' : 'bg-surface-2'}`}>
              <span className="w-6 text-center text-lg">{p.solvedAt ? ['🥇', '🥈', '🥉'][i] ?? `${i + 1}` : '—'}</span>
              <Avatar user={p.user as User} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{p.user.id === meId ? 'You' : p.user.displayName}</span>
                <span className="block text-xs text-muted">
                  {p.out ? 'Left' : p.solvedAt ? `${tries(p.attempts)}${state.startsAt ? ` · ${fmtClock(p.solvedAt - state.startsAt)}` : ''}` : `Didn’t crack it · ${tries(p.attempts)}`}
                  {p.secret != null && ` · ${p.user.id === meId ? 'your' : 'their'} number was ${p.secret}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-5 grid gap-2">
          {mine && (
            <button className={`btn ${AMBER} h-12 text-[16px] text-white`} onClick={again} disabled={busy}>
              {busy ? 'Opening…' : `New table · ${coins(state.stake)}`}
            </button>
          )}
          <button className="btn btn-soft h-12 text-[16px]" onClick={() => nav('/together')}>
            Back to Together
          </button>
        </div>
      </div>
    </div>
  );
}
