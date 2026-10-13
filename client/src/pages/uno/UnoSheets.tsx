import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { useCoins } from '../../stores/coins';
import { GroupAvatar } from '../Chats';
import { UnoCardBack, UnoCardFace } from './UnoCard';
import { uno } from './unoStore';

export const BET_MIN = 1;
export const BET_MAX = 100;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pct = (n: number, lo: number, hi: number) => (hi === lo ? 100 : ((n - lo) / (hi - lo)) * 100);

export function Coin({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ffe58a] via-[#ffc928] to-[#e99a00] shadow-[inset_0_-2px_0_rgba(0,0,0,0.15),0_1px_3px_rgba(120,80,0,0.35)] ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      aria-hidden="true"
    >
      🪙
    </span>
  );
}

/** One slider with a gold thumb. */
export function BetSlider({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const p = pct(value, min, max);
  return (
    <div className="uno-range">
      <div className="absolute top-1/2 right-0 left-0 h-2.5 -translate-y-1/2 rounded-full bg-line" />
      <div className="absolute top-1/2 left-0 h-2.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#ffd34d] to-[#f2a900]" style={{ width: `${p}%` }} />
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} disabled={min === max} />
    </div>
  );
}

/** Two thumbs on one track: lowest and highest bet anyone may place. */
function RangeSlider({ lo, hi, onChange }: { lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  return (
    <div className="uno-range">
      <div className="absolute top-1/2 right-0 left-0 h-2.5 -translate-y-1/2 rounded-full bg-line" />
      <div
        className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#ffd34d] to-[#f2a900]"
        style={{ left: `${pct(lo, BET_MIN, BET_MAX)}%`, right: `${100 - pct(hi, BET_MIN, BET_MAX)}%` }}
      />
      <input type="range" min={BET_MIN} max={BET_MAX} value={lo} onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)} aria-label="Lowest bet" />
      <input type="range" min={BET_MIN} max={BET_MAX} value={hi} onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))} aria-label="Highest bet" />
    </div>
  );
}

function Chips({ options, value, onPick }: { options: { label: string; value: number }[]; value: number; onPick: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.label}
          className={`h-9 rounded-full px-3.5 text-sm font-bold transition active:scale-95 ${o.value === value ? 'bg-[#fff1c2] text-[#8a5a00] ring-2 ring-[#f2c14e]' : 'bg-surface-2 text-muted ring-1 ring-line'}`}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function BigAmount({ n, caption }: { n: number; caption: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 py-1">
      <Coin size={40} />
      <span key={n} className="anim-pop font-display text-[46px] leading-none font-bold text-[#c27c00] tabular-nums dark:text-[#ffd35a]">
        {n}
      </span>
      <span className="text-left text-sm leading-tight font-bold text-muted">{caption}</span>
    </div>
  );
}

export function Balance({ need }: { need: number }) {
  const coins = useCoins((s) => s.coins);
  const openStore = useCoins((s) => s.openStore);
  const short = coins < need;
  return (
    <p className={`flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-bold ${short ? 'bg-[#ffe6ec] text-danger dark:bg-danger/15' : 'bg-surface-2 text-muted'}`}>
      <span className="flex items-center gap-2">
        <Coin size={18} /> You have {coins} {coins === 1 ? 'coin' : 'coins'}
      </span>
      {short && (
        <button className="rounded-full bg-danger px-3 py-1 text-white" onClick={openStore}>
          Get coins
        </button>
      )}
    </p>
  );
}

/** The host sets the bet range (1–100), places their own bet and picks who to invite. */
export function CreateTableSheet({ open, onClose, conversationId }: { open: boolean; onClose: () => void; conversationId?: number }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const coins = useCoins((s) => s.coins);
  const [lo, setLo] = useState(5);
  const [hi, setHi] = useState(25);
  const [bet, setBet] = useState(5);
  const [chat, setChat] = useState<number | null>(conversationId ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setChat(conversationId ?? null);
  }, [open, conversationId]);

  const setRange = (a: number, b: number) => {
    setLo(a);
    setHi(b);
    setBet((x) => clamp(x, a, b));
  };

  async function create() {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/uno', { body: { minBet: lo, maxBet: hi, bet, ...(chat ? { conversationId: chat } : {}) } });
      onClose();
      nav(`/uno/${code}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const sorted = chat ? [...conversations].sort((a) => (a.id === chat ? -1 : 0)) : conversations;

  return (
    <Sheet open={open} onClose={onClose} title="Create a table">
      <div className="relative -mx-5 -mt-2 mb-4 flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br from-[#2a3482] to-[#121848]">
        <span className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
        {(['red', 'yellow', 'green', 'blue'] as const).map((c, i) => (
          <span key={c} className="absolute" style={{ transform: `translateX(${(i - 1.5) * 42}px) rotate(${(i - 1.5) * 12}deg)`, top: 16 + Math.abs(i - 1.5) * 8 }}>
            <span className="anim-float block" style={{ animationDelay: `${i * 0.25}s` }}>
              <UnoCardFace card={{ color: c, value: (['7', 'skip', 'reverse', 'draw2'] as const)[i] }} w={52} />
            </span>
          </span>
        ))}
        <span className="absolute right-5 bottom-3 rotate-12">
          <span className="anim-float block" style={{ animationDelay: '0.6s' }}>
            <UnoCardBack w={40} />
          </span>
        </span>
      </div>

      <h3 className="font-display text-[17px] font-semibold">Bet range</h3>
      <p className="text-sm text-muted">Everyone who sits down bets between these amounts. The winner takes the whole pot.</p>
      <div className="mt-3 flex items-center justify-between font-display text-lg font-bold">
        <span className="flex items-center gap-1.5">
          <Coin size={20} /> {lo}
        </span>
        <span className="text-sm font-semibold text-muted">to</span>
        <span className="flex items-center gap-1.5">
          <Coin size={20} /> {hi}
        </span>
      </div>
      <RangeSlider lo={lo} hi={hi} onChange={setRange} />
      <div className="mt-1 flex flex-wrap gap-2">
        {[
          ['Friendly', 1, 10],
          ['Classic', 5, 25],
          ['High rollers', 25, 100],
        ].map(([name, a, b]) => (
          <button
            key={name as string}
            className={`h-9 rounded-full px-3.5 text-sm font-bold transition active:scale-95 ${lo === a && hi === b ? 'bg-[#fff1c2] text-[#8a5a00] ring-2 ring-[#f2c14e]' : 'bg-surface-2 text-muted ring-1 ring-line'}`}
            onClick={() => setRange(a as number, b as number)}
          >
            {name} · {a}–{b}
          </button>
        ))}
      </div>

      <h3 className="mt-6 font-display text-[17px] font-semibold">Your bet</h3>
      <BigAmount n={bet} caption={<>coins in<br />the pot</>} />
      <BetSlider value={bet} min={lo} max={hi} onChange={setBet} label="Your bet" />
      <div className="mt-3">
        <Balance need={bet} />
      </div>

      <h3 className="mt-6 font-display text-[17px] font-semibold">Invite</h3>
      <p className="text-sm text-muted">Pick a chat and everyone there gets an invite — or just share the link.</p>
      <div className="mt-2 grid gap-0.5">
        <label className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 ${chat === null ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
          <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-surface-2 text-primary-strong">
            <Icon name="link" size={20} />
          </span>
          <span className="min-w-0 flex-1 font-bold">Just me — I’ll share the link</span>
          <input type="radio" name="uno-chat" className="h-5 w-5 accent-[var(--primary)]" checked={chat === null} onChange={() => setChat(null)} />
        </label>
        {sorted.slice(0, 30).map((c) => (
          <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 ${chat === c.id ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
            <GroupAvatar c={c} meId={me.id} size={42} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <input type="radio" name="uno-chat" className="h-5 w-5 accent-[var(--primary)]" checked={chat === c.id} onChange={() => setChat(c.id)} />
          </label>
        ))}
      </div>

      <div className="sticky -bottom-5 -mx-5 mt-4 bg-surface px-5 pt-2 pb-1">
        <button
          className="btn h-14 w-full bg-gradient-to-b from-[#ef4b43] to-[#d32f2f] text-lg text-white shadow-[0_10px_22px_rgba(211,47,47,0.35)]"
          disabled={busy || coins < bet}
          onClick={create}
        >
          {busy ? 'Opening…' : (
            <>
              Open table · bet <Coin size={22} /> {bet}
            </>
          )}
        </button>
      </div>
    </Sheet>
  );
}

/** Before sitting down you choose how much to bet, inside the host's range. */
export function BetSheet({ open, onClose, min, max, pot, players }: { open: boolean; onClose: () => void; min: number; max: number; pot: number; players: number }) {
  const coins = useCoins((s) => s.coins);
  const [bet, setBet] = useState(min);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBet((b) => clamp(b, min, max));
  }, [open, min, max]);

  async function sit() {
    setBusy(true);
    try {
      await uno.sit(bet);
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const mid = Math.round((min + max) / 2);
  return (
    <Sheet open={open} onClose={onClose} title="Place your bet">
      <p className="text-sm text-muted">
        This table takes bets from <b className="text-ink">{min}</b> to <b className="text-ink">{max}</b> coins. Win the game and the whole pot is yours.
      </p>
      <div className="mt-4 rounded-[24px] bg-gradient-to-br from-[#2a3482] to-[#121848] p-4 text-white">
        <div className="flex items-center justify-between text-sm font-bold text-white/70">
          <span>Pot now</span>
          <span>{players} at the table</span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-display text-3xl font-bold">
          <Coin size={30} /> {pot}
          <span className="ml-1 text-lg text-[#ffd35a]">→ {pot + bet}</span>
        </div>
      </div>
      <div className="mt-5">
        <BigAmount n={bet} caption={<>your<br />bet</>} />
        <BetSlider value={bet} min={min} max={max} onChange={setBet} label="Your bet" />
        <div className="mt-3">
          <Chips
            value={bet}
            onPick={setBet}
            options={[
              { label: `Min · ${min}`, value: min },
              ...(mid !== min && mid !== max ? [{ label: `Half · ${mid}`, value: mid }] : []),
              ...(max !== min ? [{ label: `All in · ${max}`, value: max }] : []),
            ]}
          />
        </div>
      </div>
      <div className="mt-4">
        <Balance need={bet} />
      </div>
      <button
        className="btn mt-4 h-14 w-full bg-gradient-to-b from-[#ef4b43] to-[#d32f2f] text-lg text-white shadow-[0_10px_22px_rgba(211,47,47,0.35)]"
        disabled={busy || coins < bet}
        onClick={sit}
      >
        {busy ? 'Sitting down…' : (
          <>
            Sit down · bet <Coin size={22} /> {bet}
          </>
        )}
      </button>
      <p className="mt-2 text-center text-xs text-muted">Leave before the game starts and you get your coins back.</p>
    </Sheet>
  );
}
