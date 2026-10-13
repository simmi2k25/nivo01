import { useEffect, useState } from 'react';
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
import { Balance, BetSlider, BigAmount, Coin } from '../uno/UnoSheets';
import { QuestionTile } from './art';

const PRESETS = [5, 10, 25, 50, 100];
const RANGES = [50, 100, 1000] as const;

/** Open a Guess the Number table: the stake everyone puts in, how big the numbers go, and who to invite. */
export function CreateGuessSheet({ open, onClose, conversationId }: { open: boolean; onClose: () => void; conversationId?: number }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const coins = useCoins((s) => s.coins);
  const [stake, setStake] = useState(10);
  const [max, setMax] = useState<(typeof RANGES)[number]>(100);
  const [chat, setChat] = useState<number | null>(conversationId ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setChat(conversationId ?? null);
  }, [open, conversationId]);

  async function create() {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/guess', { body: { stake, max, ...(chat ? { conversationId: chat } : {}) } });
      onClose();
      nav(`/guess/${code}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const sorted = chat ? [...conversations].sort((a) => (a.id === chat ? -1 : 0)) : conversations;

  return (
    <Sheet open={open} onClose={onClose} title="Guess the number">
      <div className="relative -mx-5 -mt-2 mb-4 flex h-28 items-center justify-center gap-4 overflow-hidden bg-gradient-to-r from-[#fff4d6] via-[#fff9ec] to-[#ffeccc] dark:from-[#3a2f12] dark:via-surface-2 dark:to-[#3a2f12]">
        <span className="anim-float font-display text-[34px] font-bold text-[#e0a440]">42</span>
        <span className="anim-float [animation-delay:.3s]">
          <QuestionTile size={64} />
        </span>
        <span className="anim-float font-display text-[34px] font-bold text-[#e0a440] [animation-delay:.6s]">7</span>
      </div>

      <h3 className="font-display text-[17px] font-semibold">Stake</h3>
      <p className="text-sm text-muted">Everyone (2–4 players) puts this in when they lock in their number. Fewest tries takes the lot.</p>
      <BigAmount n={stake} caption={<>coins<br />each</>} />
      <BetSlider value={stake} min={1} max={100} onChange={setStake} label="Stake" />
      <div className="mt-1 flex flex-wrap gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            className={`flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-bold transition active:scale-95 ${stake === n ? 'bg-[#fff1c2] text-[#8a5a00] ring-2 ring-[#f2c14e]' : 'bg-surface-2 text-muted ring-1 ring-line'}`}
            onClick={() => setStake(n)}
          >
            <Coin size={14} /> {n}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Balance need={stake} />
      </div>

      <h3 className="mt-6 font-display text-[17px] font-semibold">Numbers</h3>
      <p className="text-sm text-muted">Secret numbers go from 1 up to…</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {RANGES.map((n) => (
          <button
            key={n}
            className={`h-12 rounded-2xl font-display text-[18px] font-bold transition active:scale-95 ${max === n ? 'bg-[#fff1c2] text-[#8a5a00] ring-2 ring-[#f2c14e]' : 'bg-surface-2 text-muted ring-1 ring-line'}`}
            onClick={() => setMax(n)}
          >
            1–{n}
          </button>
        ))}
      </div>

      <h3 className="mt-6 font-display text-[17px] font-semibold">Invite</h3>
      <p className="text-sm text-muted">Pick a chat and everyone there gets an invite — or just share the link.</p>
      <div className="mt-2 grid gap-0.5">
        <label className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 ${chat === null ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
          <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-surface-2 text-primary-strong">
            <Icon name="link" size={20} />
          </span>
          <span className="min-w-0 flex-1 font-bold">Just me — I’ll share the link</span>
          <input type="radio" name="gn-chat" className="h-5 w-5 accent-[var(--primary)]" checked={chat === null} onChange={() => setChat(null)} />
        </label>
        {sorted.slice(0, 30).map((c) => (
          <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 ${chat === c.id ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
            <GroupAvatar c={c} meId={me.id} size={42} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <input type="radio" name="gn-chat" className="h-5 w-5 accent-[var(--primary)]" checked={chat === c.id} onChange={() => setChat(c.id)} />
          </label>
        ))}
      </div>

      <div className="sticky -bottom-5 -mx-5 mt-4 bg-surface px-5 pt-2 pb-1">
        <button
          className="btn h-14 w-full bg-gradient-to-b from-[#f6b33d] to-[#e58a00] text-lg text-white shadow-[0_10px_22px_rgba(229,138,0,0.35)]"
          disabled={busy || coins < stake}
          onClick={create}
        >
          {busy ? 'Opening…' : 'Open the table'}
        </button>
      </div>
    </Sheet>
  );
}
