import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { FRAME_PACKS, frameUrl } from '../lib/frames';
import type { User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { useCoins } from '../stores/coins';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { toast } from './Toast';

/** Pick a frame for your profile photo: try any on, buy one for coins, switch between the ones you own. */
export function FrameSheet({ open, onClose, preview }: { open: boolean; onClose: () => void; preview: User }) {
  const me = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const coins = useCoins((s) => s.coins);
  const price = useCoins((s) => s.prices.frame);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [pack, setPack] = useState(FRAME_PACKS[0]?.id);
  const [picked, setPicked] = useState<string | null>(me.frame ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(me.frame ?? null);
    api<{ owned: string[] }>('/users/me/frames')
      .then((r) => setOwned(new Set(r.owned)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wearing = me.frame ?? null;
  const has = picked === null || owned.has(picked);
  const frames = FRAME_PACKS.find((p) => p.id === pack)?.frames ?? [];

  function saved(u: User) {
    setUser(u);
    useChat.getState().patchUser(u);
  }

  async function apply() {
    setBusy(true);
    try {
      if (picked && !owned.has(picked)) {
        const r = await api<{ user: User; coins: number | null }>(`/users/me/frames/${picked}`, { body: {} });
        if (r.coins != null) useCoins.getState().setBalance({ coins: r.coins });
        setOwned((s) => new Set(s).add(picked));
        saved(r.user);
        toast('New frame on ✨');
      } else {
        const r = await api<{ user: User }>('/users/me/frame', { method: 'PUT', body: { frameId: picked } });
        saved(r.user);
        toast(picked ? 'Frame on ✨' : 'Frame removed');
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const short = !has && coins < price;

  return (
    <Sheet open={open} onClose={onClose} title="Profile frames" wide>
      {/* the photo with the frame being tried on */}
      <div className="relative -mx-5 -mt-2 grid h-60 place-items-center overflow-hidden bg-gradient-to-br from-primary-soft via-surface-2 to-[#fde8ef] dark:to-surface">
        <span key={picked ?? 'none'} className="anim-pop">
          <Avatar user={{ ...preview, frame: picked }} size={112} />
        </span>
        <span className="absolute top-3 right-4 flex items-center gap-1 rounded-full bg-surface/80 px-2.5 py-1 text-sm font-extrabold text-[#8a5a00] shadow-sm dark:text-[#ffd35a]">
          🪙 {coins}
        </span>
      </div>

      <div className="scroll-thin -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {FRAME_PACKS.map((p) => (
          <button
            key={p.id}
            className={`h-9 shrink-0 rounded-full px-4 text-sm font-bold transition active:scale-95 ${pack === p.id ? 'bg-primary text-white' : 'bg-surface-2 text-muted ring-1 ring-line'}`}
            onClick={() => setPack(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        <button
          className={`relative grid aspect-square place-items-center rounded-3xl text-sm font-bold transition ${picked === null ? 'bg-primary-soft text-primary-strong ring-2 ring-primary' : 'bg-surface-2 text-muted'}`}
          onClick={() => setPicked(null)}
        >
          <span className="grid justify-items-center gap-1">
            <Icon name="x" size={22} />
            No frame
          </span>
        </button>
        {frames.map((f) => {
          const mine = owned.has(f.id);
          const on = picked === f.id;
          return (
            <button
              key={f.id}
              className={`relative grid aspect-square place-items-center rounded-3xl bg-surface-2 transition active:scale-95 ${on ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setPicked(f.id)}
              aria-label={`Frame ${f.id}${mine ? ', owned' : ''}`}
            >
              <img src={frameUrl(f.id)} alt="" className="h-[88%] w-[88%] object-contain" loading="lazy" draggable={false} />
              <span
                className={`absolute right-1.5 bottom-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold shadow-sm ${
                  wearing === f.id ? 'bg-primary text-white' : mine ? 'bg-[#dff3e6] text-[#2e7550]' : 'bg-[#fff4d6] text-[#8a5a00]'
                }`}
              >
                {wearing === f.id ? 'On' : mine ? 'Yours' : `🪙 ${price}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sticky -bottom-5 -mx-5 mt-4 bg-surface px-5 pt-2 pb-1">
        {short ? (
          <button className="btn h-13 w-full bg-danger text-white" onClick={() => useCoins.getState().openStore()}>
            You need {price} coins — get coins
          </button>
        ) : (
          <button className="btn btn-primary h-13 w-full text-lg" disabled={busy || picked === wearing} onClick={apply}>
            {busy ? 'Saving…' : picked === wearing ? (picked ? 'You’re wearing this frame' : 'No frame on') : !has ? `Buy & wear · 🪙 ${price}` : picked ? 'Wear this frame' : 'Take frame off'}
          </button>
        )}
      </div>
    </Sheet>
  );
}
