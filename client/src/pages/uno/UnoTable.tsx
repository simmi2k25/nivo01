import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { copyText } from '../../lib/share';
import type { UnoCard, UnoColor, UnoEvent, UnoPerson, UnoPlayer, UnoState } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { GroupAvatar } from '../Chats';
import { stickerUrl } from '../../lib/stickers';
import { label, UNO_HEX, UNO_THEME, UnoCardBack, UnoCardFace } from './UnoCard';
import { BetSheet, Coin, CreateTableSheet } from './UnoSheets';
import { canPlay, EMOTES, hasPlayable, joinUno, leaveUno, serverNow, sortHand, uno, useUno } from './unoStore';

const COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue'];
const TURN_MS = 30_000;

/** A steady little tilt per card so the discard pile looks tossed, the same on every phone. */
function tiltFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % 36) - 18;
}

function useWide() {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

const firstName = (u: UnoPerson | undefined | null) => u?.displayName.split(' ')[0] ?? 'Someone';

// =====================================================================================
// Page
// =====================================================================================

export default function UnoPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const nav = useNavigate();
  const loc = useLocation();
  const status = useUno((s) => s.status);
  const error = useUno((s) => s.error);
  const state = useUno((s) => s.state);
  /** Events already shown; set on first load so joining mid-game doesn't replay old ones. */
  const seen = useRef<number | null>(null);

  useEffect(() => {
    seen.current = null;
    joinUno(code);
    return () => leaveUno();
  }, [code]);

  if (state && seen.current === null) seen.current = state.events.at(-1)?.seq ?? 0;

  const back = () => (loc.key !== 'default' ? nav(-1) : nav('/together'));

  return (
    <div className="relative h-full overflow-hidden">
      {state && state.phase === 'lobby' && <Lobby state={state} seen={seen} onBack={back} />}
      {state && state.phase !== 'lobby' && <Table state={state} seen={seen} onBack={back} />}

      {status !== 'live' && (
        <div className="chill-bg absolute inset-0 z-30 grid place-items-center p-8 text-center">
          {status === 'joining' ? (
            <div className="grid justify-items-center gap-4">
              <div className="relative h-24 w-16">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="absolute inset-0" style={{ animation: `${i % 2 ? 'uno-shuffle-r' : 'uno-shuffle-l'} 0.7s ${i * 0.06}s ease-in-out infinite` }}>
                    <UnoCardBack w={64} />
                  </span>
                ))}
              </div>
              <p className="font-bold text-muted">Finding the table…</p>
            </div>
          ) : (
            <div className="card grid max-w-sm justify-items-center gap-3 p-7">
              <UnoCardBack w={56} className="-rotate-6" />
              <h2 className="text-xl font-bold">{status === 'closed' ? 'This table has closed' : 'Couldn’t open the table'}</h2>
              <p className="text-sm text-muted">{status === 'closed' ? (error ?? 'Open a new one from the Together tab.') : error}</p>
              <div className="flex gap-2">
                {status === 'error' && (
                  <button className="btn btn-soft btn-sm" onClick={() => joinUno(code)}>
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

// =====================================================================================
// Lobby: take a seat, place a bet, wait for the host to start
// =====================================================================================

function Lobby({ state, seen, onBack }: { state: UnoState; seen: MutableRefObject<number | null>; onBack: () => void }) {
  const me = useAuth((s) => s.user)!;
  const seated = state.players.some((p) => p.user.id === me.id);
  const isHost = state.hostId === me.id;
  const full = state.players.length >= state.maxPlayers;
  const [betOpen, setBetOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const [leave, setLeave] = useState(false);
  const [starting, setStarting] = useState(false);
  const asked = useRef(false);

  // The lobby doesn't animate events; just mark them seen so the table starts fresh.
  useEffect(() => {
    seen.current = Math.max(seen.current ?? 0, state.events.at(-1)?.seq ?? 0);
  }, [state.events, seen]);

  // Arriving from an invite: offer the bet straight away.
  useEffect(() => {
    if (!seated && !full && !asked.current) {
      asked.current = true;
      setBetOpen(true);
    }
  }, [seated, full]);

  async function start() {
    setStarting(true);
    const err = await uno.start();
    setStarting(false);
    if (err) toast(err, 'error');
  }

  const slots = Math.min(state.maxPlayers, Math.max(4, state.players.length + 1));
  const myBet = state.players.find((p) => p.user.id === me.id)?.bet;

  return (
    <div className="chill-bg flex h-full flex-col">
      <header className="safe-top shrink-0">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-3">
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm" onClick={() => (seated ? setLeave(true) : onBack())} aria-label="Back">
            <Icon name="back" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-[22px] leading-tight font-bold">NivoTalk Cards</h1>
            <p className="text-[13px] font-bold tracking-widest text-muted">{state.code}</p>
          </div>
          <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm" onClick={() => setInvite(true)} aria-label="Invite friends">
            <Icon name="userPlus" />
          </button>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto max-w-3xl">
          {/* pot */}
          <section className="anim-rise relative mt-2 overflow-hidden rounded-[32px] bg-gradient-to-br from-[#2d3890] via-[#1e2670] to-[#11164a] p-5 text-white shadow-[0_18px_40px_rgba(30,38,112,0.35)] md:p-7">
            <span className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
            <div className="pointer-events-none absolute -top-2 -right-4 h-40 w-44 md:right-6">
              {(['blue', 'green', 'yellow', 'red'] as const).map((c, i) => (
                <span key={c} className="absolute top-4 right-6" style={{ transform: `rotate(${-24 + i * 14}deg)`, transformOrigin: '50% 140%' }}>
                  <span className="anim-float block" style={{ animationDelay: `${i * 0.3}s` }}>
                    <UnoCardFace card={{ color: c, value: (['reverse', '9', 'draw2', 'skip'] as const)[i] }} w={58} />
                  </span>
                </span>
              ))}
            </div>
            <p className="relative text-sm font-bold tracking-wide text-white/70 uppercase">The pot</p>
            <p className="relative mt-1 flex items-center gap-3 font-display text-[52px] leading-none font-bold">
              <Coin size={44} />
              <span key={state.pot} className="anim-pop tabular-nums">
                {state.pot}
              </span>
            </p>
            <p className="relative mt-3 max-w-[60%] text-[15px] text-white/80">
              Bets {state.minBet}–{state.maxBet} coins · winner takes it all
            </p>
          </section>

          {/* seats */}
          <h2 className="mt-7 mb-3 flex items-baseline justify-between text-[22px] font-bold">
            At the table
            <span className="text-sm font-bold text-muted">
              {state.players.length}/{state.maxPlayers}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: slots }, (_, i) => {
              const p = state.players[i];
              if (!p)
                return (
                  <div key={`empty-${i}`} className="grid min-h-[150px] place-items-center rounded-[24px] border-2 border-dashed border-line text-center text-sm font-bold text-faint">
                    <span>
                      <Icon name="plus" className="mx-auto mb-1" />
                      Open seat
                    </span>
                  </div>
                );
              return (
                <div key={p.user.id} className="anim-pop relative grid justify-items-center gap-1.5 rounded-[24px] bg-surface p-4 shadow-[var(--shadow-sm)]">
                  {p.user.id === state.hostId && <span className="absolute top-2 left-2.5 text-lg" title="Host">👑</span>}
                  <Avatar user={p.user} size={58} />
                  <span className="max-w-full truncate font-bold">{p.user.id === me.id ? 'You' : p.user.displayName}</span>
                  <span className="flex items-center gap-1 rounded-full bg-[#fff4d6] px-2.5 py-0.5 text-sm font-extrabold text-[#8a5a00] dark:bg-[#4a3a10] dark:text-[#ffd35a]">
                    <Coin size={16} /> {p.bet}
                  </span>
                </div>
              );
            })}
          </div>

          <HowToPlay />
        </div>
      </div>

      {/* actions */}
      <div className="safe-bottom shrink-0 border-t border-line bg-surface/90 px-4 pt-3 pb-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2">
          {!seated ? (
            <button className="btn h-14 flex-1 bg-gradient-to-b from-[#ef4b43] to-[#d32f2f] text-lg text-white shadow-[0_10px_22px_rgba(211,47,47,0.3)]" disabled={full} onClick={() => setBetOpen(true)}>
              {full ? 'Table is full' : 'Take a seat & bet'}
            </button>
          ) : isHost ? (
            <button
              className="btn h-14 flex-1 bg-gradient-to-b from-[#ef4b43] to-[#d32f2f] text-lg text-white shadow-[0_10px_22px_rgba(211,47,47,0.3)]"
              disabled={starting || state.players.length < 2}
              onClick={start}
            >
              {state.players.length < 2 ? 'Waiting for players…' : starting ? 'Shuffling…' : `Deal the cards · ${state.players.length} players`}
            </button>
          ) : (
            <div className="flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 font-bold text-muted">
              <span className="anim-spin h-4 w-4 rounded-full border-2 border-primary-soft border-t-primary" />
              Waiting for the host to deal
            </div>
          )}
          {seated && (
            <button className="btn btn-soft h-14 px-5" onClick={() => setLeave(true)}>
              Leave
            </button>
          )}
        </div>
        {seated && myBet != null && <p className="mt-1.5 text-center text-xs font-bold text-muted">Your bet: {myBet} coins · leave before the deal to get them back</p>}
      </div>

      <BetSheet open={betOpen} onClose={() => setBetOpen(false)} min={state.minBet} max={state.maxBet} pot={state.pot} players={state.players.length} />
      <InviteSheet open={invite} onClose={() => setInvite(false)} code={state.code} />
      <LeaveSheet open={leave} onClose={() => setLeave(false)} onBack={onBack} lobby isHost={isHost} bet={myBet ?? 0} />
    </div>
  );
}

function HowToPlay() {
  const rules: [ReactNode, string][] = [
    [<MiniFace c="red" v="3" />, 'Match the top card by color, number or symbol.'],
    [<MiniFace c="blue" v="skip" />, 'Skip — the next player loses their turn.'],
    [<MiniFace c="yellow" v="reverse" />, 'Reverse — play changes direction.'],
    [<MiniFace c="red" v="draw2" />, 'Draw Two — next player draws 2 and loses their turn.'],
    [<MiniFace c="wild" v="wild" />, 'Wild — play on anything and choose the color.'],
    [<MiniFace c="wild" v="wild4" />, 'Wild Draw Four — only when you have no other card to play.'],
  ];
  return (
    <section className="mt-7 rounded-[24px] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-[19px] font-bold">How to play</h2>
      <p className="mt-1 text-sm text-muted">Everyone gets 7 cards. Can’t play? Tap the deck to draw one. Down to one card — tap “Last card!” or get caught and draw 2. First to empty their hand wins the pot.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {rules.map(([art, text], i) => (
          <li key={i} className="flex items-center gap-3 text-[15px] font-semibold">
            {art}
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MiniFace({ c, v }: { c: UnoCard['color']; v: UnoCard['value'] }) {
  return <UnoCardFace card={{ color: c, value: v }} w={34} className="shrink-0 drop-shadow" />;
}

function InviteSheet({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [sent, setSent] = useState<number[]>([]);
  async function invite(id: number) {
    try {
      await api(`/uno/${code}/invite`, { body: { conversationId: id } });
      setSent((x) => [...x, id]);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Invite to the table">
      <button className="btn btn-soft mb-2 w-full" onClick={async () => toast((await copyText(`${location.origin}/uno/${code}`)) ? 'Table link copied' : 'Couldn’t copy the link', 'info')}>
        <Icon name="link" size={19} /> Copy table link
      </button>
      <div className="grid gap-0.5">
        {conversations.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5">
            <GroupAvatar c={c} meId={me.id} size={42} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <button className={`btn btn-sm ${sent.includes(c.id) ? 'btn-soft' : 'btn-primary'}`} disabled={sent.includes(c.id)} onClick={() => invite(c.id)}>
              {sent.includes(c.id) ? 'Invited' : 'Invite'}
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function LeaveSheet({ open, onClose, onBack, lobby, isHost, bet }: { open: boolean; onClose: () => void; onBack: () => void; lobby: boolean; isHost: boolean; bet: number }) {
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    try {
      await uno.leave();
      onClose();
      onBack();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={lobby ? 'Leave the table?' : 'Leave the game?'}>
      <p className="text-[15px] text-muted">
        {lobby
          ? isHost
            ? `Closing the table sends everyone’s bets back, including your ${bet} coins.`
            : `You’ll get your ${bet} coins back. Or keep your seat and come back before the deal.`
          : `If you leave now you forfeit — your ${bet} coins stay in the pot.`}
      </p>
      <div className="mt-5 grid gap-2">
        <button className="btn h-12 bg-danger text-white" disabled={busy} onClick={leave}>
          {busy ? 'Leaving…' : lobby ? (isHost ? 'Close table & refund everyone' : 'Leave & get my coins back') : 'Forfeit & leave'}
        </button>
        {lobby && !isHost && (
          <button className="btn btn-soft h-12" onClick={() => (onClose(), onBack())}>
            Keep my seat & go back
          </button>
        )}
        <button className="btn btn-soft h-12" onClick={onClose}>
          {lobby ? 'Stay here' : 'Keep playing'}
        </button>
      </div>
    </Sheet>
  );
}

// =====================================================================================
// Table: the game itself
// =====================================================================================

type Flight = { id: number; from: DOMRect; to: DOMRect; card: UnoCard | null; delay: number; w: number; rot: number; onLand?: () => void };
type Badge = { id: number; x: number; y: number; text: ReactNode; tone: string };
type Banner = { id: number; text: ReactNode; sub?: ReactNode; color: string };

let fxId = 0;

function Table({ state, seen, onBack }: { state: UnoState; seen: MutableRefObject<number | null>; onBack: () => void }) {
  const me = useAuth((s) => s.user)!;
  const emotes = useUno((s) => s.emotes);
  const wide = useWide();
  const cardW = wide ? 96 : 74;
  const pileW = wide ? 112 : 84;

  const you = state.you;
  const seated = !!you && !you.out;
  const playing = state.phase === 'playing';
  const myTurn = playing && seated && state.turnUserId === me.id;
  const top = state.pile.at(-1);
  const hand = useMemo(() => sortHand(you?.hand ?? []), [you?.hand]);
  const canAnything = myTurn && hasPlayable(hand, top, state.color);
  const mustDraw = myTurn && !state.drewThisTurn && !canAnything;
  const byId = useMemo(() => new Map(state.players.map((p) => [p.user.id, p])), [state.players]);
  const nameOf = (id?: number) => (id === me.id ? 'You' : firstName(byId.get(id ?? -1)?.user));

  const anchors = useRef(new Map<string, HTMLElement>());
  const anchor = (key: string) => (el: HTMLElement | null) => void (el ? anchors.current.set(key, el) : anchors.current.delete(key));
  const rectOf = (key: string) => anchors.current.get(key)?.getBoundingClientRect() ?? null;
  const tapRects = useRef(new Map<string, DOMRect>());

  const [flights, setFlights] = useState<Flight[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [landing, setLanding] = useState<Set<string>>(new Set());
  const [intro, setIntro] = useState<'shuffle' | 'deal' | null>(null);
  const [dealt, setDealt] = useState(0);
  /** My card on its way to the pile: it lifts out of the hand until the server takes it. */
  const [hidden, setHidden] = useState<string | null>(null);
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);
  const [wildFor, setWildFor] = useState<UnoCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [leave, setLeave] = useState(false);
  const [emotePicker, setEmotePicker] = useState(false);
  const [again, setAgain] = useState(false);
  // Effects scheduled for later are skipped once the table is gone (not cancelled: a dev remount would lose them).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  // Zero-delay effects run right away, so a played card starts flying in the same frame it leaves the hand.
  const later = (ms: number, fn: () => void) => (ms <= 0 ? alive.current && fn() : void setTimeout(() => alive.current && fn(), ms));

  // ---------- effects ----------

  const fly = (f: Omit<Flight, 'id'>) => setFlights((x) => [...x, { ...f, id: ++fxId }]);
  const badge = (key: string, text: ReactNode, tone: string) => {
    const r = rectOf(key);
    if (!r) return;
    const b = { id: ++fxId, x: r.left + r.width / 2, y: r.top, text, tone };
    setBadges((x) => [...x, b]);
    later(1400, () => setBadges((x) => x.filter((y) => y.id !== b.id)));
  };
  const shout = (text: ReactNode, color: string, sub?: ReactNode) => {
    const b = { id: ++fxId, text, color, sub };
    setBanner(b);
    later(1500, () => setBanner((x) => (x?.id === b.id ? null : x)));
  };
  const seatKey = (id?: number) => (id === me.id && seated ? 'hand' : `p:${id}`);
  const drawFlights = (to: number | undefined, count: number, delay: number) => {
    const from = rectOf('deck');
    const dest = rectOf(seatKey(to));
    if (!from || !dest) return;
    for (let i = 0; i < count; i++) fly({ from, to: dest, card: null, delay: delay + i * 110, w: pileW, rot: 0 });
  };

  function run(e: UnoEvent, at: number): number {
    switch (e.type) {
      case 'start': {
        setIntro('shuffle');
        setDealt(0);
        later(at + 2000, () => {
          setIntro('deal');
          const order = state.players.map((p) => p.user.id);
          const step = Math.min(70, 2600 / (7 * order.length));
          const from = rectOf('deck');
          let n = 0;
          for (let r = 0; r < 7; r++)
            for (const id of order) {
              const to = rectOf(seatKey(id));
              const mine = id === me.id;
              if (from && to)
                fly({ from, to, card: null, delay: n * step, w: pileW, rot: 0, onLand: mine ? () => setDealt((d) => d + 1) : undefined });
              n++;
            }
          later(n * step + 650, () => {
            setIntro(null);
            setDealt(99);
          });
        });
        return at + 2000;
      }
      case 'play': {
        const card = e.card!;
        const from = e.by === me.id ? (tapRects.current.get(card.id) ?? rectOf('hand')) : rectOf(`p:${e.by}`);
        later(at, () => {
          const to = rectOf('pile');
          if (!from || !to) return;
          setLanding((s) => new Set(s).add(card.id));
          fly({ from, to, card, delay: 0, w: pileW, rot: tiltFor(card.id), onLand: () => setLanding((s) => ((s = new Set(s)), s.delete(card.id), s)) });
        });
        if (card.color === 'wild') later(at + 450, () => shout(card.value === 'wild4' ? '+4' : 'Wild!', UNO_HEX[e.color!], <>{nameOf(e.by)} picked <b>{e.color}</b></>));
        return at + 380;
      }
      case 'skip':
        later(at, () => {
          shout('Skip!', UNO_HEX[state.color]);
          badge(seatKey(e.target), '⊘ Skipped', '#e8352e');
        });
        return at + 200;
      case 'reverse':
        later(at, () => shout('Reverse!', UNO_HEX[state.color], 'Play changes direction'));
        return at + 200;
      case 'penalty':
        later(at, () => {
          if (e.count === 2) shout('+2', UNO_HEX[state.color], <>{nameOf(e.target)} draws 2</>);
          badge(seatKey(e.target), `+${e.count}`, '#e8352e');
        });
        drawFlights(e.target, e.count ?? 0, at + 150);
        if (e.target === me.id) navigator.vibrate?.([40, 40, 40]);
        return at + 150 + (e.count ?? 0) * 110;
      case 'draw':
        drawFlights(e.by, e.count ?? 0, at);
        return at + 300;
      case 'pass':
        later(at, () => badge(seatKey(e.by), 'Pass', '#6f84de'));
        return at;
      case 'uno':
        later(at, () => {
          shout('Last card!', '#ef7d9a', <>{nameOf(e.by)} {e.by === me.id ? 'are' : 'is'} on the last card</>);
          badge(seatKey(e.by), '📣 Last card!', '#ef7d9a');
        });
        return at + 300;
      case 'caught':
        later(at, () => shout('Caught!', '#f7c21b', <>{nameOf(e.target)} forgot to call last card — draws 2</>));
        drawFlights(e.target, e.count ?? 2, at + 200);
        return at + 400;
      case 'timeout':
        later(at, () => badge(seatKey(e.by), '⏰ Time’s up', '#f2a900'));
        if (e.by === me.id) toast('Time’s up — you drew a card', 'info');
        return at + 200;
      case 'forfeit':
        later(at, () => shout('Left', '#9aa3c9', <>{nameOf(e.by)} left the game</>));
        return at + 300;
      case 'reshuffle':
        later(at, () => badge('deck', '🔀 Reshuffled', '#6f84de'));
        return at;
      default:
        return at;
    }
  }

  // Before paint: the flight must replace the card that just left the hand without a blank frame between.
  useLayoutEffect(() => {
    const last = seen.current ?? 0;
    const fresh = state.events.filter((e) => e.seq > last);
    if (!fresh.length) return;
    seen.current = fresh.at(-1)!.seq;
    let at = 0;
    for (const e of fresh) at = run(e, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.events]);

  // The card in flight from my hand has left it once the server agrees.
  useEffect(() => {
    if (hidden && !hand.some((c) => c.id === hidden)) setHidden(null);
  }, [hand, hidden]);

  // ---------- moves ----------

  function nope(id: string, why: string) {
    setShake((s) => ({ id, n: (s?.n ?? 0) + 1 }));
    navigator.vibrate?.(60);
    toast(why, 'error');
  }

  function why(card: UnoCard) {
    if (card.value === 'wild4') return 'Wild Draw Four only when you have no other card to play';
    const t = top ? label(top) : 'top card';
    return `That doesn’t match — play a ${state.color} card or match the ${t}`;
  }

  function tap(card: UnoCard, el: HTMLElement) {
    if (intro || busy || !playing) return;
    if (!myTurn) return nope(card.id, `Wait for your turn — it’s ${nameOf(state.turnUserId ?? undefined)}’s go`);
    if (you?.drawnId && card.id !== you.drawnId) return nope(card.id, 'Play the card you just drew, or pass');
    if (!canPlay(card, hand, top, state.color)) return nope(card.id, why(card));
    tapRects.current.set(card.id, el.getBoundingClientRect());
    if (card.color === 'wild') return setWildFor(card);
    send(card);
  }

  async function send(card: UnoCard, color?: UnoColor) {
    setBusy(true);
    setHidden(card.id);
    const err = await uno.play(card.id, color);
    setBusy(false);
    if (err) {
      setHidden(null);
      toast(err, 'error');
    }
  }

  async function act(fn: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) toast(err, 'error');
  }

  function tapDeck() {
    if (intro || !playing || !seated) return;
    if (!myTurn) return toast('Wait for your turn', 'info');
    if (state.drewThisTurn) return toast('Play the card you drew, or pass', 'info');
    if (canAnything) {
      const first = hand.find((c) => canPlay(c, hand, top, state.color));
      if (first) setShake({ id: first.id, n: (shake?.n ?? 0) + 1 });
      return toast('You have a card you can play — it’s glowing', 'info');
    }
    act(uno.draw);
  }

  // ---------- layout ----------

  const myIndex = state.players.findIndex((p) => p.user.id === me.id);
  const others = myIndex >= 0 ? [...state.players.slice(myIndex + 1), ...state.players.slice(0, myIndex)] : state.players;
  const turnName = state.turnUserId === me.id ? 'Your turn!' : `${nameOf(state.turnUserId ?? undefined)}’s turn`;
  const canCallUno = seated && playing && ((myTurn && hand.length === 2 && canAnything && !state.drewThisTurn) || state.unoPending === me.id);
  const catchable = seated && playing && state.unoPending != null && state.unoPending !== me.id ? byId.get(state.unoPending) : null;
  const tint = UNO_HEX[state.color];

  return (
    <div className="uno-felt relative flex h-full flex-col overflow-hidden">
      {/* table glow in the color that's in play */}
      <div className="pointer-events-none absolute top-[38%] left-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[70px] transition-colors duration-700" style={{ background: tint }} />

      <header className="safe-top relative z-10 shrink-0">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 md:h-16">
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur" onClick={() => (seated && playing ? setLeave(true) : onBack())} aria-label="Leave">
            <Icon name="back" />
          </button>
          <div className="flex min-w-0 flex-1 justify-center">
            <span className="flex items-center gap-2 rounded-full bg-black/25 py-1 pr-4 pl-1.5 font-display text-lg font-bold ring-1 ring-[#ffd35a]/40">
              <Coin size={26} /> <span className="tabular-nums">{state.pot}</span>
              <span className="text-sm font-semibold text-white/60">pot</span>
            </span>
          </div>
          {seated && playing ? (
            <div className="relative">
              <button className="grid h-10 w-10 place-items-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur" onClick={() => setEmotePicker((v) => !v)} aria-label="React">
                <Icon name="smile" />
              </button>
              {emotePicker && (
                <div className="anim-pop absolute top-12 right-0 z-30 grid w-[176px] grid-cols-4 gap-1 rounded-2xl bg-[#11164a]/95 p-2 shadow-2xl ring-1 ring-white/15">
                  {EMOTES.map((e) => (
                    <button
                      key={e}
                      className="grid h-10 place-items-center rounded-xl text-2xl transition hover:bg-white/10 active:scale-90"
                      onClick={() => {
                        uno.emote(e);
                        setEmotePicker(false);
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="w-10" />
          )}
        </div>
      </header>

      {/* opponents */}
      <div className="relative z-10 shrink-0 px-2">
        <div className="scroll-thin mx-auto flex max-w-5xl justify-start gap-1 overflow-x-auto px-1 pt-1 pb-2 sm:justify-center md:gap-4">
          {others.map((p) => (
            <Opponent
              key={p.user.id}
              p={p}
              active={state.turnUserId === p.user.id && playing}
              endsAt={state.turnEndsAt}
              winner={state.winnerId === p.user.id}
              uno={p.count === 1 && !p.out}
              host={state.hostId === p.user.id}
              anchorRef={anchor(`p:${p.user.id}`)}
              emotes={emotes.filter((e) => e.userId === p.user.id).map((e) => ({ id: e.id, emoji: e.emoji }))}
            />
          ))}
        </div>
      </div>

      {/* centre of the table */}
      <div className="relative z-10 grid min-h-0 flex-1 place-items-center">
        <div className="relative grid place-items-center">
          <DirectionRing direction={state.direction} color={tint} size={pileW * 3.3} />
          {intro === 'shuffle' || intro === 'deal' ? (
            <div className="grid justify-items-center gap-4">
              <div ref={anchor('deck')}>
                <ShuffleDeck w={pileW} dealing={intro === 'deal'} />
              </div>
              <p className="font-display text-lg font-semibold text-white/80">{intro === 'shuffle' ? 'Shuffling…' : 'Dealing…'}</p>
            </div>
          ) : (
            <div className="flex items-center gap-6 md:gap-10">
              <button
                ref={anchor('deck')}
                className={`relative rounded-[12px] transition active:scale-95 ${mustDraw ? 'uno-glow' : ''}`}
                style={{ width: pileW, height: pileW * 1.5 }}
                onClick={tapDeck}
                aria-label={mustDraw ? 'Draw a card' : 'Draw pile'}
              >
                {[3, 2, 1, 0].map((i) => (
                  <span key={i} className="absolute inset-0" style={{ transform: `translate(${i * -1.5}px, ${i * -2}px)` }}>
                    <UnoCardBack w={pileW} />
                  </span>
                ))}
                {mustDraw && (
                  <span className="absolute -bottom-9 left-1/2 -translate-x-1/2 rounded-full bg-[#ffd35a] px-3 py-1 text-sm font-extrabold whitespace-nowrap text-[#4a3200] shadow-lg">
                    Tap to draw
                  </span>
                )}
              </button>
              <div ref={anchor('pile')} className="relative" style={{ width: pileW, height: pileW * 1.5 }}>
                {state.pile
                  .filter((c) => !landing.has(c.id))
                  .map((c, i, arr) => (
                    <span key={c.id} className="absolute inset-0 transition-transform" style={{ transform: `rotate(${tiltFor(c.id)}deg)`, filter: i < arr.length - 1 ? 'brightness(0.8)' : undefined }}>
                      <UnoCardFace card={c} w={pileW} className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.4)]" />
                    </span>
                  ))}
                {top?.color === 'wild' && (
                  <span className="absolute -right-3 -bottom-3 h-8 w-8 rounded-full ring-4 ring-white/90 transition-colors" style={{ background: tint }} aria-label={`Color is ${state.color}`} />
                )}
              </div>
            </div>
          )}
        </div>
        {playing && !intro && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center px-4">
            <span
              key={state.turnUserId ?? 0}
              className={`anim-pop flex items-center gap-2 rounded-full px-4 py-1.5 font-display text-[15px] font-semibold ${myTurn ? 'bg-[#ffd35a] text-[#3a2800] shadow-[0_0_24px_rgba(255,211,90,0.6)]' : 'bg-black/30 text-white/85'}`}
            >
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: tint }} />
              {myTurn && state.drewThisTurn ? 'Play the card you drew — or pass' : turnName}
            </span>
          </div>
        )}
      </div>

      {/* my side */}
      {seated && playing ? (
        <div className="safe-bottom relative z-10 shrink-0">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 pb-1">
            <span ref={anchor(`p:${me.id}`)} className="relative">
              <Avatar user={me} size={40} />
              {myTurn && state.turnEndsAt && <TimerRing endsAt={state.turnEndsAt} size={48} />}
              <EmoteFloat emotes={emotes.filter((e) => e.userId === me.id)} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-bold text-white/70">
              {hand.length} {hand.length === 1 ? 'card' : 'cards'}
            </span>
            {catchable && (
              <button className="anim-pop h-11 rounded-full bg-[#ffd35a] px-4 font-display font-bold text-[#3a2800] shadow-[0_0_20px_rgba(255,211,90,0.6)] active:scale-95" onClick={() => act(uno.catchUno)}>
                🚨 Catch {firstName(catchable.user)}!
              </button>
            )}
            {myTurn && state.drewThisTurn && (
              <button className="h-11 rounded-full bg-white/15 px-5 font-display font-bold ring-1 ring-white/25 active:scale-95" disabled={busy} onClick={() => act(uno.pass)}>
                Pass
              </button>
            )}
            {canCallUno && (
              <button
                className={`relative h-12 overflow-hidden rounded-full bg-gradient-to-b from-[#ff5a4f] to-[#d32f2f] px-6 font-display text-xl font-bold italic shadow-[0_8px_22px_rgba(232,53,46,0.55)] ring-2 ring-[#ffd35a] active:scale-95 ${state.unoPending === me.id ? 'uno-glow' : ''}`}
                onClick={() => act(uno.callUno)}
              >
                <span className="absolute inset-y-0 left-0 w-1/3 bg-white/30" style={{ animation: 'uno-shine-sweep 1.6s ease-in-out infinite' }} />
                Last card!
              </button>
            )}
          </div>
          <Hand
            cards={hand}
            cardW={cardW}
            myTurn={myTurn && !intro}
            playable={(c) => myTurn && !intro && canPlay(c, hand, top, state.color) && (!you?.drawnId || you.drawnId === c.id)}
            pending={hidden}
            rects={tapRects.current}
            shake={shake}
            showUpTo={intro ? dealt : 99}
            anchorRef={anchor('hand')}
            onTap={tap}
          />
        </div>
      ) : (
        <div className="safe-bottom relative z-10 shrink-0 px-4 pb-4 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 text-sm font-bold text-white/80">
            <Icon name="eye" size={18} /> {you?.out ? 'You left this game — watching' : 'You’re watching this game'}
          </span>
        </div>
      )}

      {/* effects */}
      {flights.map((f) => (
        <FlightView key={f.id} f={f} done={(id) => setFlights((x) => x.filter((y) => y.id !== id))} />
      ))}
      {badges.map((b) => (
        <span
          key={b.id}
          className="pointer-events-none fixed z-50 rounded-full px-3 py-1 font-display text-[15px] font-bold whitespace-nowrap text-white shadow-lg"
          style={{ left: b.x, top: b.y, background: b.tone, animation: 'uno-badge 1.4s ease-out both' }}
        >
          {b.text}
        </span>
      ))}
      {banner && (
        <div key={banner.id} className="pointer-events-none fixed top-[42%] left-1/2 z-50 grid justify-items-center text-center" style={{ animation: 'uno-burst 1.5s cubic-bezier(.2,.8,.2,1) both' }}>
          <span
            className="font-display text-[64px] leading-none font-bold italic md:text-[88px]"
            style={{ color: banner.color, WebkitTextStroke: '3px #fff', paintOrder: 'stroke', textShadow: `0 6px 0 rgba(0,0,0,0.25), 0 0 40px ${banner.color}` }}
          >
            {banner.text}
          </span>
          {banner.sub && <span className="mt-2 rounded-full bg-black/45 px-4 py-1 text-[15px] font-bold text-white">{banner.sub}</span>}
        </div>
      )}

      {wildFor && (
        <ColorPicker
          card={wildFor}
          onPick={(c) => {
            const card = wildFor;
            setWildFor(null);
            send(card, c);
          }}
          onClose={() => setWildFor(null)}
        />
      )}

      {state.phase === 'finished' && !again && <Result state={state} onBack={onBack} onAgain={() => setAgain(true)} />}

      <LeaveSheet open={leave} onClose={() => setLeave(false)} onBack={onBack} lobby={false} isHost={false} bet={byId.get(me.id)?.bet ?? 0} />
      <CreateTableSheet open={again} onClose={() => setAgain(false)} conversationId={state.conversationId ?? undefined} />
    </div>
  );
}

// ---------- table pieces ----------

function Opponent(p: {
  p: UnoPlayer;
  active: boolean;
  endsAt: number | null;
  winner: boolean;
  uno: boolean;
  host: boolean;
  anchorRef: (el: HTMLElement | null) => void;
  emotes: { id: number; emoji: string }[];
}) {
  const { user, count, out, online, bet } = p.p;
  return (
    <div className={`relative flex w-[84px] shrink-0 flex-col items-center gap-1 rounded-2xl px-1 py-1.5 transition md:w-[104px] ${p.active ? 'bg-white/12' : ''} ${out ? 'opacity-40 grayscale' : ''}`}>
      <span ref={p.anchorRef} className="relative">
        {p.active && <span className="absolute -inset-1.5 rounded-full bg-[#ffd35a]/40" style={{ animation: 'uno-pulse-ring 1.4s ease-out infinite' }} />}
        <span className={`relative block rounded-full ${p.active ? 'ring-3 ring-[#ffd35a]' : 'ring-2 ring-white/20'}`}>
          <Avatar user={user} size={48} />
        </span>
        {p.active && p.endsAt && <TimerRing endsAt={p.endsAt} size={60} />}
        {!online && !out && <span className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full bg-[#9aa3c9] ring-2 ring-[#1a2063]" title="Offline" />}
        {p.host && <span className="absolute -top-2 -left-1 text-sm">👑</span>}
        {p.winner && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xl">🏆</span>}
        <EmoteFloat emotes={p.emotes} />
      </span>
      <span className="max-w-full truncate text-[13px] font-bold">{firstName(user)}</span>
      <span className="flex h-6 items-center">
        {Array.from({ length: Math.min(count, 6) }, (_, i) => (
          <span key={i} style={{ marginLeft: i ? -11 : 0, transform: `rotate(${(i - Math.min(count, 6) / 2) * 6}deg)` }}>
            <UnoCardBack w={15} />
          </span>
        ))}
        <span className="ml-1 text-[13px] font-extrabold tabular-nums">{out ? 'out' : count}</span>
      </span>
      {p.uno ? (
        <span className="anim-pop rounded-full bg-[#ef7d9a] px-2 text-[11px] font-extrabold tracking-wide ring-1 ring-white/60">LAST</span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] font-bold text-[#ffd35a]">
          <Coin size={12} /> {bet}
        </span>
      )}
    </div>
  );
}

function EmoteFloat({ emotes }: { emotes: { id: number; emoji: string }[] }) {
  return (
    <>
      {emotes.map((e) => (
        <span key={e.id} className="pointer-events-none absolute top-0 left-1/2 z-40 text-[34px]" style={{ animation: 'uno-emote 2.1s ease-out both' }}>
          {e.emoji}
        </span>
      ))}
    </>
  );
}

/** Gold countdown around whoever is playing. */
function TimerRing({ endsAt, size }: { endsAt: number; size: number }) {
  const remaining = Math.max(0, endsAt - serverNow());
  const total = Math.max(TURN_MS, remaining);
  const r = size / 2 - 2.5;
  const len = 2 * Math.PI * r;
  const from = len * (1 - remaining / total);
  return (
    <svg width={size} height={size} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
      <circle
        key={endsAt}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={remaining < 8000 ? '#ff6b5e' : '#ffd35a'}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={len}
        style={{ '--from': `${from}px`, '--len': `${len}px`, animation: `uno-timer ${remaining}ms linear forwards` } as CSSProperties}
      />
    </svg>
  );
}

function DirectionRing({ direction, color, size }: { direction: 1 | -1; color: string; size: number }) {
  const r = size / 2 - 6;
  const c = size / 2;
  const arrow = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return <path key={deg} d="M-7 -6 L5 0 L-7 6 Z" fill={color} transform={`translate(${c + r * Math.cos(a)} ${c + r * Math.sin(a)}) rotate(${deg + 90 * direction})`} />;
  };
  return (
    <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70" aria-hidden="true">
      <svg width={size} height={size} className={`block ${direction === 1 ? 'uno-ring-cw' : 'uno-ring-ccw'}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray="2 14" strokeLinecap="round" />
        {[0, 120, 240].map(arrow)}
      </svg>
    </span>
  );
}

function ShuffleDeck({ w, dealing }: { w: number; dealing: boolean }) {
  return (
    <div className="relative" style={{ width: w, height: w * 1.5 }}>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute inset-0"
          style={{
            transform: `translate(${-i * 0.6}px, ${-i * 0.9}px)`,
            animation: dealing ? undefined : `${i % 2 ? 'uno-shuffle-r' : 'uno-shuffle-l'} 0.62s ${i * 0.022}s ease-in-out 3 both`,
          }}
        >
          <UnoCardBack w={w} className="drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />
        </span>
      ))}
    </div>
  );
}

/** My cards, fanned. Legal cards lift and glow; the rest dim on my turn and shake if tapped. */
function Hand(p: {
  cards: UnoCard[];
  cardW: number;
  myTurn: boolean;
  playable: (c: UnoCard) => boolean;
  pending: string | null;
  /** Where each card last sat on screen, so a played card can fly from exactly there. */
  rects: Map<string, DOMRect>;
  shake: { id: string; n: number } | null;
  showUpTo: number;
  anchorRef: (el: HTMLElement | null) => void;
  onTap: (c: UnoCard, el: HTMLElement) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cards = p.cards.slice(0, p.showUpTo);
  const n = cards.length;
  const w = p.cardW;
  const avail = Math.min(width, 900) - 64; // room for the tilt of the outer cards
  const step = n > 1 ? Math.min(w * 0.66, (avail - w) / (n - 1)) : 0;
  const total = w + step * (n - 1);
  const left0 = (width - total) / 2;
  const spread = Math.min(4, 36 / Math.max(n, 1));
  const els = useRef(new Map<string, HTMLElement>());

  // Remember where every card is after each change (and once it settles), for the flight to the pile.
  useLayoutEffect(() => {
    for (const [id, el] of els.current) p.rects.set(id, el.getBoundingClientRect());
  });

  return (
    <div
      ref={(el) => {
        box.current = el;
        p.anchorRef(el);
      }}
      className="relative mx-auto w-full max-w-5xl"
      style={{ height: w * 1.5 + 46 }}
    >
      {cards.map((c, i) => {
        const rel = i - (n - 1) / 2;
        const ok = p.playable(c);
        const dim = p.myTurn && !ok;
        const shaking = p.shake?.id === c.id;
        const leaving = p.pending === c.id;
        // Position lives in the transform (not `left`) so the fan glides closed when a card leaves.
        const lift = leaving ? -46 : ok ? -18 : 0;
        return (
          <button
            key={c.id}
            ref={(el) => void (el ? els.current.set(c.id, el) : els.current.delete(c.id))}
            className="uno-hand-card group absolute bottom-6 left-0 rounded-[11%] hover:[--hov:-14px] focus-visible:[--hov:-14px]"
            style={{
              width: w,
              zIndex: leaving ? 50 : i,
              transformOrigin: '50% 120%',
              transform: `translateX(${left0 + i * step}px) translateY(calc(${Math.abs(rel) ** 1.6 * 1.6}px + ${lift}px + ${leaving ? '0px' : 'var(--hov, 0px)'})) rotate(${leaving ? 0 : rel * spread}deg) scale(${leaving ? 1.06 : 1})`,
              pointerEvents: leaving ? 'none' : undefined,
            }}
            onTransitionEnd={(e) => e.propertyName === 'transform' && p.rects.set(c.id, e.currentTarget.getBoundingClientRect())}
            onClick={(e) => p.onTap(c, e.currentTarget)}
            aria-label={`${label(c)}${ok ? ' — playable' : ''}`}
          >
            <span className="block" style={{ animation: p.showUpTo < 99 ? undefined : `uno-deal-in 0.4s ${i * 0.03}s cubic-bezier(.2,.8,.2,1) both` }}>
              <span key={shaking ? `s${p.shake!.n}` : 'still'} className={`block rounded-[11%] ${shaking ? 'uno-shake' : ''} ${ok && !leaving ? 'uno-glow' : ''}`}>
                <UnoCardFace
                  card={c}
                  w={w}
                  className="drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)] transition-[filter] duration-500 ease-out"
                  style={{ filter: dim ? 'brightness(0.55) saturate(0.6)' : undefined }}
                />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FlightView({ f, done }: { f: Flight; done: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = f.w * 1.5;
    const sFrom = Math.max(0.3, Math.min(1.1, f.from.width / f.w));
    const sTo = Math.max(0.3, Math.min(1, f.to.width / f.w));
    const fx = f.from.left + f.from.width / 2 - f.w / 2;
    const fy = f.from.top + f.from.height / 2 - h / 2;
    const tx = f.to.left + f.to.width / 2 - f.w / 2;
    const ty = f.to.top + f.to.height / 2 - h / 2;
    const spin = f.card ? f.rot : (Math.random() - 0.5) * 40;
    const a = el.animate(
      [
        { transform: `translate(${fx}px, ${fy}px) scale(${sFrom}) rotate(0deg)` },
        { transform: `translate(${(fx + tx) / 2}px, ${Math.min(fy, ty) - 50}px) scale(${Math.max(sFrom, sTo) * 1.08}) rotate(${spin / 2}deg)`, offset: 0.5 },
        { transform: `translate(${tx}px, ${ty}px) scale(${sTo}) rotate(${spin}deg)` },
      ],
      { duration: 560, delay: f.delay, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' },
    );
    a.onfinish = () => {
      f.onLand?.();
      done(f.id);
    };
    return () => a.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="pointer-events-none fixed top-0 left-0 z-40 drop-shadow-[0_12px_20px_rgba(0,0,0,0.45)]" style={{ width: f.w, transformOrigin: '50% 50%' }}>
      {f.card ? <UnoCardFace card={f.card} w={f.w} /> : <UnoCardBack w={f.w} />}
    </div>
  );
}

function ColorPicker({ card, onPick, onClose }: { card: UnoCard; onPick: (c: UnoColor) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" role="dialog" aria-modal="true" aria-label="Pick a color">
      <button className="anim-fade absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="Cancel" />
      <div className="anim-pop relative grid justify-items-center gap-5">
        <UnoCardFace card={card} w={80} className="-rotate-6 drop-shadow-2xl" />
        <p className="font-display text-2xl font-bold text-white">Pick a color</p>
        <div className="grid grid-cols-2 gap-3">
          {COLORS.map((c, i) => (
            <button
              key={c}
              className="anim-pop grid h-28 w-28 place-items-center content-center gap-0.5 rounded-[30px] font-display text-[15px] font-bold capitalize shadow-[0_10px_24px_rgba(0,0,0,0.35)] ring-4 ring-white transition hover:scale-105 active:scale-95"
              style={{ background: UNO_THEME[c].bg, color: UNO_THEME[c].ink, animationDelay: `${i * 0.05}s` }}
              onClick={() => onPick(c)}
            >
              <img src={stickerUrl(UNO_THEME[c].buddy)} alt="" className="h-14 w-14 object-contain" draggable={false} />
              {c}
            </button>
          ))}
        </div>
        <button className="rounded-full bg-white/15 px-5 py-2 font-bold text-white ring-1 ring-white/25" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Confetti, the winner's crown and the pot flying to them. */
function Result({ state, onBack, onAgain }: { state: UnoState; onBack: () => void; onAgain: () => void }) {
  const me = useAuth((s) => s.user)!;
  const winner = state.players.find((p) => p.user.id === state.winnerId);
  const iWon = state.winnerId === me.id;
  const mine = state.players.find((p) => p.user.id === me.id);
  const confetti = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        color: [UNO_HEX.red, UNO_HEX.yellow, UNO_HEX.green, UNO_HEX.blue, '#ffffff'][i % 5],
        delay: Math.random() * 1.6,
        dur: 2.6 + Math.random() * 2,
        dx: `${(Math.random() - 0.5) * 160}px`,
        rot: `${(Math.random() - 0.5) * 1440}deg`,
        w: 6 + Math.random() * 6,
      })),
    [],
  );
  const coins = useMemo(
    () => Array.from({ length: 16 }, () => ({ dx: `${(Math.random() - 0.5) * 320}px`, dy: `${-80 - Math.random() * 200}px`, rot: `${(Math.random() - 0.5) * 720}deg`, delay: Math.random() * 0.4 })),
    [],
  );
  const ranked = [...state.players].sort((a, b) => (a.user.id === state.winnerId ? -1 : b.user.id === state.winnerId ? 1 : a.count - b.count));

  return (
    <div className="anim-fade fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0b0f30]/75 p-5 backdrop-blur-sm">
      {confetti.map((c, i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-0"
          style={{
            left: `${c.left}%`,
            width: c.w,
            height: c.w * 1.6,
            background: c.color,
            borderRadius: 2,
            '--dx': c.dx,
            '--rot': c.rot,
            animation: `uno-confetti ${c.dur}s ${c.delay}s linear infinite`,
          } as CSSProperties}
        />
      ))}
      <div className="anim-pop relative w-full max-w-sm rounded-[32px] bg-surface p-6 text-center text-ink shadow-2xl">
        <div className="relative mx-auto -mt-16 w-fit">
          <span className="anim-float absolute -top-9 left-1/2 -translate-x-1/2 text-[44px]">👑</span>
          <span className="block rounded-full ring-4 ring-[#ffd35a] shadow-[0_0_40px_rgba(255,211,90,0.7)]">{winner && <Avatar user={winner.user} size={96} />}</span>
          {coins.map((c, i) => (
            <span
              key={i}
              className="pointer-events-none absolute top-1/2 left-1/2"
              style={{ '--dx': c.dx, '--dy': c.dy, '--rot': c.rot, animation: `uno-coin 1.4s ${c.delay}s cubic-bezier(.2,.8,.2,1) both` } as CSSProperties}
            >
              <Coin size={26} />
            </span>
          ))}
        </div>
        <h2 className="mt-4 font-display text-[30px] leading-tight font-bold">{iWon ? 'You win!' : `${firstName(winner?.user)} wins!`}</h2>
        <p className="mt-1 flex items-center justify-center gap-2 font-display text-2xl font-bold text-[#c27c00] dark:text-[#ffd35a]">
          {iWon ? '+' : ''}
          <Coin size={26} /> {state.payout} {iWon ? 'coins' : 'coin pot'}
        </p>
        {!iWon && mine && <p className="mt-1 text-sm text-muted">Better luck next time — your {mine.bet} coins went to the pot.</p>}

        <ul className="mt-5 grid gap-1.5 text-left">
          {ranked.map((p, i) => (
            <li key={p.user.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${i === 0 ? 'bg-[#fff4d6] dark:bg-[#4a3a10]' : 'bg-surface-2'}`}>
              <span className="w-5 text-center font-display font-bold text-muted">{i === 0 ? '🏆' : i + 1}</span>
              <Avatar user={p.user} size={32} />
              <span className="min-w-0 flex-1 truncate font-bold">{p.user.id === me.id ? 'You' : p.user.displayName}</span>
              <span className="text-sm font-bold text-muted">{p.out ? 'left' : i === 0 ? 'won' : `${p.count} left`}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 grid gap-2">
          <button className="btn h-13 bg-gradient-to-b from-[#ef4b43] to-[#d32f2f] text-lg text-white shadow-[0_10px_22px_rgba(211,47,47,0.3)]" onClick={onAgain}>
            Play again
          </button>
          <button className="btn btn-soft h-12" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
