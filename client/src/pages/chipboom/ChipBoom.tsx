import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CoinButton } from '../../components/CoinStore';
import { CommentBubbles, CommentButton } from '../../components/GameComments';
import { MicBadge, useTableVoice, VoiceButton, type Voice } from '../../components/VoiceChat';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { publicOrigin } from '../../lib/native';
import { copyText } from '../../lib/share';
import { stickerUrl } from '../../lib/stickers';
import type { CbSeat, CbSide, CbState, CbTile } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { GroupAvatar } from '../Chats';
import { Coin } from '../uno/UnoSheets';
import { BombArt, ChipArt, Mascot, PreviewGrid, SIDE_INFO } from './art';
import { cb, joinCb, leaveCb, REACTIONS, serverNow, useCb } from './cbStore';

const other = (s: CbSide): CbSide => (s === 'blue' ? 'pink' : 'blue');
const coins = (n: number) => `${n} ${n === 1 ? 'coin' : 'coins'}`;

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
/** Side-by-side layout (boards left and right, rules in the middle). */
const useDesktop = () => useMedia('(min-width: 900px)');

export default function ChipBoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const status = useCb((s) => s.status);
  const error = useCb((s) => s.error);
  const state = useCb((s) => s.state);
  const meId = useAuth((s) => s.user)!.id;
  // Players at the table share a voice room (lobby and game alike); onlookers just watch.
  const seated = !!state && (state.blue?.user.id === meId || state.pink?.user.id === meId);
  const voice = useTableVoice(seated && state.phase !== 'finished' ? `cb:${code}` : null);

  useEffect(() => {
    joinCb(code);
    return () => leaveCb();
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
              <p className="font-bold text-muted">Setting up the grids…</p>
            </div>
          ) : (
            <div className="card anim-rise grid max-w-sm justify-items-center gap-3 p-7">
              <BombArt size={64} />
              <h2 className="text-xl font-bold">{status === 'closed' ? 'This table has closed' : 'Couldn’t open the table'}</h2>
              <p className="text-sm text-muted">{error}</p>
              <div className="flex gap-2">
                {status === 'error' && (
                  <button className="btn btn-soft btn-sm" onClick={() => joinCb(code)}>
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

/** Comments float up the left side: above the phone's bottom bar, or beside the boards on a wide screen. */
function TableComments({ lobby }: { lobby: boolean }) {
  const me = useAuth((s) => s.user)!;
  const comments = useCb((s) => s.comments);
  return <CommentBubbles comments={comments} meId={me.id} className={lobby ? 'bottom-28 left-3 md:left-[104px]' : 'bottom-[84px] left-3 min-[900px]:bottom-32 min-[900px]:left-[120px]'} />;
}

function useMe(state: CbState) {
  const me = useAuth((s) => s.user)!;
  const mySide: CbSide | null = state.blue?.user.id === me.id ? 'blue' : state.pink?.user.id === me.id ? 'pink' : null;
  return { me, mySide };
}

function BackButton({ label, onClick }: { label?: string; onClick: () => void }) {
  return label ? (
    <button className="flex h-12 items-center gap-2 rounded-full bg-surface px-5 font-display text-[17px] font-semibold text-primary-strong shadow-[var(--shadow-sm)] transition active:scale-95" onClick={onClick}>
      <Icon name="back" size={20} /> {label}
    </button>
  ) : (
    <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-primary-strong shadow-[var(--shadow-sm)] transition active:scale-95" onClick={onClick} aria-label="Back">
      <Icon name="back" />
    </button>
  );
}

// ================================================================ lobby

function Lobby({ state, voice }: { state: CbState; voice: Voice }) {
  const nav = useNavigate();
  const wide = useDesktop();
  const { me, mySide } = useMe(state);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const isHost = state.hostId === me.id;
  const mine = mySide ? state[mySide] : null;
  const ready = !!mine?.ready;
  const openSide: CbSide | null = !state.blue ? 'blue' : !state.pink ? 'pink' : null;
  const opponent = mySide ? state[other(mySide)] : null;

  async function run(fn: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) toast(err, 'error');
  }
  const pick = (side: CbSide) => {
    if (side === mySide || state[side] || ready) return;
    run(() => cb.side(side));
  };

  async function leaveTable() {
    if (isHost) {
      if (!confirm('Close this table? Any stakes are refunded.')) return;
      await cb.close().catch((e) => toast(errorText(e), 'error'));
    } else if (mySide) {
      await cb.leave().catch((e) => toast(errorText(e), 'error'));
    }
    nav('/together');
  }

  const primary = !mySide ? (
    <button className="btn btn-primary h-14 flex-1 text-lg md:min-w-[320px] md:flex-none" disabled={!openSide || busy} onClick={() => openSide && pick(openSide)}>
      {openSide ? `Take the ${openSide} side` : 'The table is full'}
    </button>
  ) : ready ? (
    <button className={`cb-${mySide} cb-solid btn h-14 flex-1 text-lg text-white opacity-90 md:min-w-[320px] md:flex-none`} disabled>
      <span className="anim-spin h-4 w-4 rounded-full border-2 border-white/40 border-t-white" />
      {opponent?.ready ? 'Starting…' : `Waiting for ${opponent ? opponent.user.displayName : 'a friend'}`}
    </button>
  ) : (
    <button
      className={`cb-${mySide} cb-solid btn h-14 flex-1 text-lg text-white shadow-[0_14px_30px_var(--cb-glow)] md:min-w-[320px] md:flex-none`}
      disabled={busy}
      onClick={() => run(cb.ready)}
    >
      {busy ? 'Getting ready…' : `Ready with ${mySide}`}
      {wide && (
        <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-sm">
          <Coin size={16} /> {state.stake}
        </span>
      )}
    </button>
  );
  const secondary = mySide && (
    ready ? (
      <button className="btn h-14 bg-surface px-6 text-lg text-primary-strong ring-2 ring-line" disabled={busy} onClick={() => run(cb.unready)}>
        Not ready
      </button>
    ) : (
      openSide && (
        <button className="btn h-14 bg-surface px-6 text-lg text-primary-strong ring-2 ring-line" disabled={busy} onClick={() => pick(openSide)}>
          Switch to {openSide}
        </button>
      )
    )
  );

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-4 pb-6 md:px-8">
          <header className="safe-top grid grid-cols-[auto_1fr_auto] items-center gap-3 pt-4 md:pt-8">
            <BackButton label={wide ? 'Together' : undefined} onClick={() => nav('/together')} />
            <span />
            <span className="flex items-center gap-2">
              {mySide && <VoiceButton voice={voice} />}
              <CommentButton onSend={cb.say} />
              {(isHost || mySide) && openSide && (
                <button className="grid h-10 w-10 place-items-center rounded-full bg-surface text-primary-strong shadow-[var(--shadow-sm)]" onClick={() => setInvite(true)} aria-label="Invite a friend">
                  <Icon name="userPlus" size={19} />
                </button>
              )}
              <CoinButton />
            </span>
          </header>

          <div className="anim-rise mt-3 text-center md:-mt-4">
            <p className="text-[13px] font-bold tracking-[0.2em] text-muted uppercase md:text-[15px]">Chip or Boom</p>
            <h1 className="mt-1 text-[34px] leading-tight font-bold md:mt-2 md:text-[52px]">Choose your side</h1>
            <p className="mx-auto mt-1 max-w-md text-[16px] text-muted md:max-w-none md:text-[18px]">One player uses the blue grid, the other uses the pink grid.</p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#fff4d6] px-3.5 py-1.5 text-sm font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 dark:bg-[#3a2f12] dark:text-[#ffd36b]">
              <Coin size={18} /> {coins(state.stake)} each · winner takes {state.stake * 2}
            </p>
          </div>

          <div className="relative mt-6 grid gap-4 md:mt-8 md:grid-cols-2 md:gap-8">
            {(['blue', 'pink'] as CbSide[]).map((side) => (
              <SideCard key={side} side={side} seat={state[side]} meId={me.id} mine={mySide === side} canPick={!state[side] && !ready && !busy} onPick={() => pick(side)} wide={wide} voice={voice} />
            ))}
            {wide && (
              <span className="absolute top-1/2 left-1/2 z-10 grid h-[88px] w-[88px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[6px] border-[var(--bg)] bg-[#2f2a52] font-display text-[30px] font-bold text-white shadow-lg">
                VS
              </span>
            )}
          </div>

          <HowToPlay wide={wide} target={state.target} lives={state.lives} />

          {wide && (
            <div className="mt-7 flex justify-center gap-4">
              {secondary}
              {primary}
            </div>
          )}
          {(isHost || mySide) && (
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

function SideCard({ side, seat, meId, mine, canPick, onPick, wide, voice }: { side: CbSide; seat: CbSeat | null; meId: number; mine: boolean; canPick: boolean; onPick: () => void; wide: boolean; voice: Voice }) {
  const info = SIDE_INFO[side];
  const roomy = useMedia('(min-width: 1500px)');
  const tile = !wide ? 29 : roomy ? 70 : 50;
  const status = !seat
    ? 'Open seat'
    : seat.user.id === meId
      ? seat.ready
        ? 'Ready ✓'
        : 'You are here'
      : `${seat.user.displayName} ${seat.ready ? 'is ready ✓' : 'is here'}`;
  return (
    <button
      type="button"
      className={`cb-${side} cb-card anim-rise relative flex w-full items-center gap-4 rounded-[34px] p-4 text-left transition duration-300 md:gap-8 md:rounded-[44px] md:p-9 ${
        mine ? 'ring-[4px] ring-[var(--cb-ring)]' : canPick ? 'hover:-translate-y-0.5 hover:shadow-[0_16px_40px_var(--cb-glow)]' : ''
      }`}
      onClick={onPick}
      disabled={!canPick}
      aria-label={`${info.name}: ${status}`}
    >
      {mine && (
        <span className="cb-solid absolute -top-4 left-7 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-bold text-white shadow-md md:left-10 md:text-[17px]">
          <Icon name="check" size={16} /> Your side
        </span>
      )}
      <PreviewGrid side={side} tile={tile} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-3 md:block">
          <Mascot side={side} size={!wide ? 50 : roomy ? 112 : 84} />
          <span className={`cb-ink block font-display leading-tight font-bold whitespace-nowrap md:mt-5 ${!wide ? 'text-[25px]' : roomy ? 'text-[46px]' : 'text-[34px]'}`}>{info.name}</span>
        </span>
        <span className="mt-2 block text-[15px] leading-snug text-muted md:mt-3 md:text-[18px]">
          {wide ? `${info.mascot}’s side. Tap tiles on the ${side} board to find chips.` : `${info.mascot}’s side of the board.`}
        </span>
        <span className="cb-ink mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-white px-3.5 py-1.5 text-[15px] font-bold shadow-sm md:mt-5 md:px-4 md:text-[17px] dark:bg-surface">
          {seat?.online === false && seat.user.id !== meId && <span className="h-2 w-2 shrink-0 rounded-full bg-faint" />}
          {status}
          {seat && <MicBadge voice={voice} userId={seat.user.id} />}
        </span>
      </span>
    </button>
  );
}

const STEPS: { title: string; short: string; long: string; tone: string }[] = [
  { title: 'Choose your side', short: 'Blue or pink grid.', long: 'One player uses the blue grid, the other the pink grid.', tone: 'bg-[#e6eaff] text-[#4553b8]' },
  { title: 'Take turns', short: 'Tap a tile on your turn.', long: 'Each player flips one tile on their own grid per turn.', tone: 'bg-[#e6eaff] text-[#4553b8]' },
  { title: 'Find safe chips', short: 'A tile hides a chip or a bomb.', long: 'A tile may reveal a chip or a bomb.', tone: 'bg-[#fff1c7] text-[#9a6a00]' },
  { title: 'Avoid bombs', short: 'Each one costs a life.', long: 'Hitting a bomb costs you one of your lives.', tone: 'bg-[#ece8f8] text-[#4a4266]' },
  { title: 'Win', short: 'Most chips, or survive the longest.', long: 'Collect the chips first, or outlast your friend.', tone: 'bg-[#dff3e6] text-[#2e7550]' },
];

function HowToPlay({ wide, target, lives }: { wide: boolean; target: number; lives: number }) {
  const steps = STEPS.map((s, i) => (i === 4 ? { ...s, short: `First to ${target} chips, or survive the longest.`, long: `Collect ${target} chips first, or be the one with lives left.` } : i === 3 ? { ...s, long: `Hitting a bomb costs one of your ${lives} lives.` } : s));
  return (
    <section className="anim-rise mt-6 rounded-[32px] bg-surface p-5 shadow-[var(--shadow-sm)] md:mt-8 md:rounded-[40px] md:p-9">
      <h2 className="text-[24px] font-bold md:text-[28px]">How to play</h2>
      <ol className={`mt-3 grid gap-3.5 md:mt-5 ${wide ? 'grid-cols-5 gap-6' : ''}`}>
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3.5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[17px] font-bold md:h-11 md:w-11 ${s.tone}`}>{i + 1}</span>
            {wide ? (
              <span>
                <span className="block font-display text-[19px] font-bold">{s.title}</span>
                <span className="mt-1 block leading-snug text-muted">{s.long}</span>
              </span>
            ) : (
              <span className="pt-1.5 leading-snug">
                <b className="font-display font-bold">{s.title}.</b> <span className="text-muted">{s.short}</span>
              </span>
            )}
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
  const link = `${publicOrigin()}/chipboom/${code}`;
  const text = `Play Chip or Boom with me 💣 · ${coins(stake)} each\nTable code: ${code}`;
  return (
    <Sheet open={open} onClose={onClose} title="Invite a friend">
      <div className="rounded-2xl bg-primary-soft p-4 text-center">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">Table code</p>
        <p className="font-display text-4xl font-bold tracking-[0.2em] text-primary-strong">{code}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-soft btn-sm" onClick={async () => toast((await copyText(`${text}\n${link}`)) ? 'Invite copied' : link)}>
          <Icon name="link" size={17} /> Copy invite
        </button>
        <button
          className="btn btn-soft btn-sm"
          onClick={() => (navigator.share ? navigator.share({ title: 'Chip or Boom', text, url: link }).catch(() => {}) : copyText(`${text}\n${link}`).then(() => toast('Invite copied')))}
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
                api(`/chipboom/${code}/invite`, { body: { conversationId: c.id } })
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

type Fx = { key: number; side: CbSide; tile: CbTile; index: number };

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [on]);
}

function Game({ state, voice }: { state: CbState; voice: Voice }) {
  const nav = useNavigate();
  const wide = useDesktop();
  const { mySide } = useMe(state);
  const reactions = useCb((s) => s.reactions);
  const [pending, setPending] = useState<number | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const seen = useRef<number | null>(null);
  const left: CbSide = mySide ?? 'blue';
  const right = other(left);
  const playing = state.phase === 'playing';
  const myTurn = playing && !!mySide && state.turn === mySide;
  useTick(playing);

  // Flip results come in as events: shake the board for a bomb, float a +1 for a chip.
  useEffect(() => {
    const last = state.events.at(-1)?.seq ?? 0;
    if (seen.current == null) {
      seen.current = last;
      return;
    }
    const fresh = state.events.filter((e) => e.seq > seen.current!);
    seen.current = last;
    for (const e of fresh) {
      if (e.type !== 'reveal' || !e.side || !e.tile || e.index == null) continue;
      setFx({ key: e.seq, side: e.side, tile: e.tile, index: e.index });
      if (e.side === mySide && e.tile === 'bomb') navigator.vibrate?.([60, 40, 90]);
    }
  }, [state.events, mySide]);

  // The tapped tile has flipped (or the turn moved on): stop waiting on it.
  useEffect(() => {
    if (pending == null || !mySide) return;
    if (state[mySide]?.tiles[pending] != null || !myTurn) setPending(null);
  }, [state, pending, mySide, myTurn]);

  async function tap(index: number) {
    if (!myTurn || pending != null) return;
    setPending(index);
    const err = await cb.reveal(index);
    if (err) {
      setPending(null);
      toast(err, 'error');
    }
  }

  async function giveUp() {
    if (!mySide || !playing) return nav('/together');
    const them = state[other(mySide)]?.user.displayName ?? 'Your friend';
    if (!confirm(`Give up? ${them} wins the pot of ${coins(state.pot)}.`)) return;
    await cb.leave().catch((e) => toast(errorText(e), 'error'));
  }

  const leave = () => (mySide && playing ? giveUp() : nav('/together'));
  const turnName = state.turn ? (state.turn === mySide ? 'Your' : `${state[state.turn]?.user.displayName ?? 'Their'}’s`) : '';
  const hint = !playing
    ? ''
    : !mySide
      ? `${turnName} turn — you’re watching`
      : myTurn
        ? pending != null
          ? 'Flipping…'
          : `Tap any tile on your ${mySide} grid to flip it`
        : `${state[other(mySide)]?.user.displayName ?? 'Your friend'} is picking a tile…`;
  const subtitle = `Round ${Math.max(1, state.round)} · First to ${state.target} chips wins · Stake ${coins(state.stake)}`;

  const board = (side: CbSide, compact = false) => (
    <Board
      side={side}
      seat={state[side]}
      state={state}
      voice={voice}
      isMe={side === mySide}
      compact={compact}
      pending={side === mySide ? pending : null}
      fx={fx?.side === side ? fx : null}
      onTap={side === mySide && myTurn ? tap : undefined}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {wide ? (
        <header className="safe-top grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-8 pt-6">
          <span>
            <BackButton label={mySide && playing ? 'Leave' : 'Together'} onClick={leave} />
          </span>
          <div className="text-center">
            <h1 className="text-[30px] leading-tight font-bold">Chip or Boom</h1>
            <p className="text-muted">{subtitle}</p>
          </div>
          <span className="flex items-center justify-end gap-3">
            <PotBadge pot={state.pot} />
            {mySide && <VoiceButton voice={voice} className="md:!h-14 md:!w-14" />}
            <CommentButton onSend={cb.say} className="[&>button]:!h-14 [&>button]:!w-14" />
          </span>
        </header>
      ) : (
        <header className="safe-top flex shrink-0 items-center gap-3 px-3 pt-3">
          <BackButton onClick={leave} />
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-[20px] leading-tight font-bold">Chip or Boom</h1>
            <p className="truncate text-xs text-muted">
              Round {Math.max(1, state.round)} · First to {state.target} · {coins(state.stake)}
            </p>
          </div>
          <PotBadge pot={state.pot} small />
          {mySide && <VoiceButton voice={voice} />}
          <CommentButton onSend={cb.say} />
        </header>
      )}

      {wide ? (
        <div className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 grid-cols-[minmax(0,1fr)_300px_minmax(0,1fr)] items-center gap-8 px-8 py-6">
          {board(left)}
          <div className="flex flex-col items-center gap-5">
            <TimerRing state={state} size={190} />
            <TurnPill state={state} mySide={mySide} left={left} />
            <QuickRules lives={state.lives} target={state.target} />
          </div>
          {board(right)}
        </div>
      ) : (
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-2">
          {board(right, true)}
          <div className="flex items-center gap-3 px-1">
            <TimerRing state={state} size={52} />
            <p className={`min-w-0 flex-1 text-[15px] leading-snug font-bold ${myTurn ? `cb-${mySide} cb-ink` : 'text-muted'}`}>{hint}</p>
          </div>
          {board(left)}
        </div>
      )}

      <footer className={`safe-bottom flex shrink-0 items-center gap-3 ${wide ? 'px-8 pt-2 pb-6' : 'border-t border-line bg-surface/85 px-3 pt-2 pb-2 backdrop-blur'}`}>
        <div className={`flex gap-2 ${wide ? '' : 'min-w-0 flex-1 overflow-x-auto'}`}>
          {REACTIONS.map((id) => (
            <button
              key={id}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 active:scale-90 disabled:opacity-40 md:h-14 md:w-14"
              onClick={() => cb.react(id)}
              disabled={!mySide}
              aria-label="Send a reaction"
            >
              <img src={stickerUrl(id)} alt="" className="h-8 w-8 object-contain md:h-10 md:w-10" />
            </button>
          ))}
        </div>
        {wide && <p className="flex-1 text-right text-[17px] text-muted">{hint}</p>}
        {mySide && playing && (
          <button className="btn h-11 shrink-0 bg-surface px-5 text-primary-strong ring-2 ring-line md:h-14 md:px-7 md:text-lg" onClick={giveUp}>
            Give up
          </button>
        )}
      </footer>

      {/* reactions float up from the bottom */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center">
        {reactions.map((r) => (
          <img key={r.id} src={stickerUrl(r.stickerId)} alt="" className="cb-float absolute h-20 w-20 object-contain drop-shadow-lg" style={{ left: `${30 + ((r.id * 37) % 40)}%` }} />
        ))}
      </div>

      {state.phase === 'finished' && <Finished state={state} mySide={mySide} />}
    </div>
  );
}

function PotBadge({ pot, small = false }: { pot: number; small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-2 rounded-full bg-[#fff4d6] font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 dark:bg-[#3a2f12] dark:text-[#ffd36b] ${
        small ? 'h-10 px-2.5 text-sm' : 'h-14 px-5 text-[19px]'
      }`}
    >
      <Coin size={small ? 22 : 30} />
      <span key={pot} className="anim-pop tabular-nums">
        {!small && 'Pot '}
        {pot}
      </span>
    </span>
  );
}

function TimerRing({ state, size }: { state: CbState; size: number }) {
  const left = state.turnEndsAt ? Math.max(0, state.turnEndsAt - serverNow()) : 0;
  const frac = state.turnEndsAt ? left / state.turnMs : 0;
  const side = state.turn ?? 'blue';
  const stroke = size > 100 ? 14 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const secs = Math.ceil(left / 1000);
  const low = secs <= 5 && state.phase === 'playing';
  return (
    <div className={`cb-${side} relative grid shrink-0 place-items-center`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          className="cb-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={low ? '#e8577b' : side === 'blue' ? '#4a7fe0' : '#e0688f'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span
        className="grid place-items-center rounded-full bg-surface text-center shadow-[var(--shadow-sm)]"
        style={{ width: size - stroke * 2 - (size > 100 ? 16 : 4), height: size - stroke * 2 - (size > 100 ? 16 : 4) }}
      >
        <span>
          <span className={`block font-display leading-none font-bold tabular-nums ${low ? 'text-danger' : ''}`} style={{ fontSize: size > 100 ? 46 : 17 }}>
            {size > 100 ? `0:${String(secs).padStart(2, '0')}` : secs}
          </span>
          {size > 100 && <span className="mt-1 block text-muted">to pick</span>}
        </span>
      </span>
    </div>
  );
}

function TurnPill({ state, mySide, left }: { state: CbState; mySide: CbSide | null; left: CbSide }) {
  if (!state.turn) return null;
  const mine = state.turn === mySide;
  const name = mine ? 'Your turn' : `${state[state.turn]?.user.displayName ?? 'Their'}’s turn`;
  const pointsLeft = state.turn === left;
  return (
    <span key={state.turn} className={`cb-${state.turn} cb-solid anim-pop flex items-center gap-2 rounded-full px-5 py-2.5 font-display text-[17px] font-bold text-white shadow-[0_10px_24px_var(--cb-glow)] md:text-[20px]`}>
      <span className="hidden md:inline">{pointsLeft && <Icon name="back" size={18} />}</span>
      {name}
      <span className="hidden md:inline">{!pointsLeft && <Icon name="arrowRight" size={18} />}</span>
    </span>
  );
}

function QuickRules({ lives, target }: { lives: number; target: number }) {
  const row = (art: ReactNode, title: string, text: string) => (
    <li className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2">{art}</span>
      <span>
        <span className="block font-bold">{title}</span>
        <span className="block text-sm leading-snug text-muted">{text}</span>
      </span>
    </li>
  );
  return (
    <section className="w-full rounded-[28px] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-[19px] font-bold">Quick rules</h2>
      <ul className="mt-3 grid gap-3">
        {row(<ChipArt size={28} />, 'Safe chip', 'Adds 1 to your score')}
        {row(<BombArt size={28} />, 'Boom', `Lose one of your ${lives} lives`)}
        {row(<Icon name="star" size={22} className="text-[#2e7550]" />, 'Win', `First to ${target} chips, or last one with lives`)}
      </ul>
    </section>
  );
}

function Hearts({ lives, max, size = 22 }: { lives: number; max: number; size?: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${lives} of ${max} lives left`}>
      {Array.from({ length: max }, (_, i) => {
        const full = i < lives;
        return (
          <svg key={`${i}-${full}`} width={size} height={size} viewBox="0 0 24 24" className={full ? '' : 'cb-heart-lost'} aria-hidden="true">
            <path
              d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"
              fill={full ? '#ef4f6c' : 'none'}
              stroke={full ? '#d93a58' : '#e8a3b2'}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        );
      })}
    </span>
  );
}

function Board(p: { side: CbSide; seat: CbSeat | null; state: CbState; voice: Voice; isMe: boolean; compact: boolean; pending: number | null; fx: Fx | null; onTap?: (i: number) => void }) {
  const { side, seat, state, compact } = p;
  const active = state.phase === 'playing' && state.turn === side;
  const name = p.isMe ? 'You' : (seat?.user.displayName ?? 'Open seat');
  const tag = active ? (p.isMe ? 'Your turn' : `${seat?.user.displayName ?? 'Their'}’s turn`) : state.phase === 'playing' ? `${p.isMe ? 'You are' : `${seat?.user.displayName ?? 'They'} is`} waiting` : '';
  const tiles = seat?.tiles ?? Array(16).fill(null);
  const shakeKey = p.fx?.tile === 'bomb' ? p.fx.key : 0;

  const score = (
    <>
      <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-display text-[17px] font-bold shadow-sm md:text-[20px] dark:bg-surface">
        <ChipArt size={compact ? 18 : 22} />
        <span key={seat?.chips} className="anim-pop tabular-nums">
          {seat?.chips ?? 0}
        </span>
        <span className="text-muted">/ {state.target}</span>
      </span>
      <Hearts lives={seat?.lives ?? state.lives} max={state.lives} size={compact ? 16 : 22} />
    </>
  );
  const header = compact ? (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Mascot side={side} size={36} />
        <span className="min-w-0 flex-1 truncate font-display text-[17px] font-bold">{name}</span>
        {seat && <MicBadge voice={p.voice} userId={seat.user.id} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">{score}</div>
    </div>
  ) : (
    <div className="mb-4 flex items-center gap-3 md:mb-5">
      <Mascot side={side} size={56} className="md:!h-[72px] md:!w-[72px]" />
      <span className="min-w-0 flex-1 truncate font-display text-[22px] font-bold md:text-[28px]">
        {name}
        {seat && !seat.online && !p.isMe && <span className="ml-2 align-middle text-xs font-semibold text-muted">offline</span>}
        {seat && (
          <span className="ml-2 inline-block align-middle">
            <MicBadge voice={p.voice} userId={seat.user.id} />
          </span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1.5">{score}</span>
    </div>
  );

  const grid = (
    <div key={shakeKey} className={`grid grid-cols-4 ${compact ? 'gap-1.5' : 'gap-2.5 md:gap-4'} ${shakeKey ? 'cb-shake' : ''}`}>
      {tiles.map((t, i) => (
        <Tile key={i} tile={t} index={i} compact={compact} pending={p.pending === i} fx={p.fx?.index === i ? p.fx : null} onTap={p.onTap} />
      ))}
    </div>
  );

  return (
    <section
      className={`cb-${side} cb-card relative rounded-[30px] transition-shadow duration-500 md:rounded-[40px] ${compact ? 'p-3' : 'p-4 md:p-7'} ${active ? 'cb-turn-glow' : 'shadow-[var(--shadow-sm)]'}`}
    >
      {tag && !compact && (
        <span
          className={`absolute -top-4 left-1/2 -translate-x-1/2 rounded-full px-5 py-1.5 text-[15px] font-bold whitespace-nowrap shadow-md md:text-[17px] ${active ? 'cb-solid text-white' : 'cb-ink bg-white dark:bg-surface'}`}
        >
          {tag}
        </span>
      )}
      {compact ? (
        <div className="flex items-center gap-3">
          <div className="w-[44%] max-w-[170px] shrink-0">{grid}</div>
          <div className="min-w-0 flex-1">
            {header}
            {tag && <p className={`mt-2 truncate text-sm font-bold ${active ? 'cb-ink' : 'text-muted'}`}>{tag}</p>}
          </div>
        </div>
      ) : (
        <>
          {header}
          {grid}
        </>
      )}
      {shakeKey > 0 && <span key={`f${shakeKey}`} className="cb-boom-flash pointer-events-none absolute inset-0 rounded-[inherit] bg-[#ff5a7a]" />}
    </section>
  );
}

function Tile({ tile, index, compact, pending, fx, onTap }: { tile: CbTile | null; index: number; compact: boolean; pending: boolean; fx: Fx | null; onTap?: (i: number) => void }) {
  // Animate only a flip we saw happen — not tiles that were already face up when the screen opened.
  const was = useRef(tile);
  const flipped = was.current === null && tile !== null;
  useEffect(() => {
    was.current = tile;
  }, [tile]);
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (flipped) setAnim(true);
  }, [flipped]);

  if (tile === null) {
    return (
      <button
        type="button"
        className={`cb-tile cb-tile-hidden grid aspect-square place-items-center font-display font-bold ${compact ? 'text-[15px]' : 'text-[30px] md:text-[44px]'} ${pending ? 'cb-tile-pending' : ''}`}
        disabled={!onTap}
        onClick={() => onTap?.(index)}
        aria-label={`Tile ${index + 1}, face down`}
      >
        ?
      </button>
    );
  }
  return (
    <span className={`cb-tile cb-tile-${tile} relative grid aspect-square place-items-center ${anim || flipped ? 'cb-flip' : ''}`} aria-label={`Tile ${index + 1}: ${tile}`}>
      <span className={`grid h-full w-full place-items-center ${anim || flipped ? 'cb-pop' : ''}`}>
        {tile === 'chip' ? <ChipArt size={compact ? 26 : 72} className={compact ? '' : 'h-[70%] w-[70%]'} /> : <BombArt size={compact ? 22 : 64} className={compact ? '' : 'h-[58%] w-[58%]'} />}
      </span>
      {fx?.tile === 'chip' && !compact && (
        <span key={fx.key} className="cb-plus pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 font-display text-[22px] font-bold text-[#d98d0a] drop-shadow">
          +1
        </span>
      )}
    </span>
  );
}

// ================================================================ the end

function Finished({ state, mySide }: { state: CbState; mySide: CbSide | null }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const winSide: CbSide | null = state.blue?.user.id === state.winnerId ? 'blue' : state.pink?.user.id === state.winnerId ? 'pink' : null;
  const won = !!mySide && winSide === mySide;
  const winner = winSide ? state[winSide] : null;
  const loserSide = winSide ? other(winSide) : null;
  const gaveUp = state.events.some((e) => e.type === 'forfeit');
  const loserName = !loserSide ? '' : mySide === loserSide ? 'You' : (state[loserSide]?.user.displayName ?? 'They');
  const why = !winner ? '' : gaveUp ? `${loserName} gave up` : winner.chips >= state.target ? `${won ? 'You' : winner.user.displayName} found ${state.target} chips` : `${loserName} ran out of lives`;

  async function again() {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/chipboom', { body: { stake: state.stake, ...(state.conversationId ? { conversationId: state.conversationId } : {}) } });
      nav(`/chipboom/${code}`, { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="anim-fade fixed inset-0 z-40 grid place-items-center bg-[#1b2148]/45 p-5 backdrop-blur-sm">
      <div className={`${winSide ? `cb-${winSide}` : ''} anim-rise card w-full max-w-sm p-7 text-center`}>
        {winSide && <img src={stickerUrl(SIDE_INFO[winSide].hello)} alt="" className="anim-float mx-auto h-28 w-28 object-contain" />}
        <h2 className="mt-2 text-[30px] leading-tight font-bold">{won ? 'You won! 🎉' : winner ? `${winner.user.displayName} won` : 'Game over'}</h2>
        <p className="mt-1 text-muted">{why}</p>
        {won ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#fff4d6] px-4 py-2 font-display text-[22px] font-bold text-[#8a5a00] ring-1 ring-[#f2c14e]/60 dark:bg-[#3a2f12] dark:text-[#ffd36b]">
            <Coin size={26} /> +{state.payout}
          </p>
        ) : (
          mySide && <p className="mt-3 text-sm font-semibold text-muted">{winner?.user.displayName ?? 'They'} took the pot of {coins(state.payout)}</p>
        )}
        <div className="mt-6 grid gap-2">
          {mySide && (
            <button className="btn btn-primary h-12 text-[16px]" onClick={again} disabled={busy}>
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
