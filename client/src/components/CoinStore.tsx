import { useState } from 'react';
import { errorText, api } from '../lib/api';
import { useCoins } from '../stores/coins';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { toast } from './Toast';

/** The coin pill in page headers: shows your balance and opens the store. */
export function CoinButton({ light = false }: { light?: boolean }) {
  const coins = useCoins((s) => s.coins);
  const open = useCoins((s) => s.openStore);
  return (
    <button
      onClick={open}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-sm font-extrabold shadow-sm transition active:scale-95 ${
        light ? 'bg-white/20 text-white ring-1 ring-white/30 backdrop-blur-md' : 'bg-[#fff4d6] text-[#8a5a00] ring-1 ring-[#f2c14e]/60'
      }`}
      aria-label={`${coins} coins — open the coin store`}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#ffd86b] to-[#f2a900] text-[13px] text-white shadow-inner">
        🪙
      </span>
      {coins}
    </button>
  );
}

const REASONS: Record<string, string> = {
  welcome: 'Welcome gift',
  purchase: 'Bought coins',
  gift_sent: 'Sent to a friend',
  gift_received: 'Gift from a friend',
  memory: 'More Memories space',
  wallpaper: 'Chat wallpaper',
  group_create: 'Started a group',
  group_join: 'Joined a group',
  watermark: 'Strip without watermark',
  owner_grant: 'Owner top-up',
};

/** Balance, coin packs, what coins unlock, extra Memories space and recent history. */
export function CoinStore() {
  const s = useCoins();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const buy = (packId: string) =>
    run(packId, async () => {
      const r = await api<{ coins: number }>('/coins/buy', { body: { packId } });
      s.setBalance({ coins: r.coins });
      toast('Coins added 🪙');
      await s.load();
    });

  const memory = (pack: 'small' | 'large') =>
    run(pack, async () => {
      const r = await api<{ coins: number; memorySlots: number }>('/coins/memory', { body: { pack } });
      s.setBalance(r);
      toast(`Memories now holds ${r.memorySlots} strips ✨`);
      await s.load();
    });

  const p = s.prices;
  const unlocks = [
    { icon: '🖼️', label: 'Chat wallpaper for everyone in the chat', cost: p.wallpaper },
    { icon: '👯', label: 'Start a group chat', cost: p.groupCreate },
    { icon: '💌', label: 'Join a group you’re invited to', cost: p.groupJoin },
    { icon: '✨', label: 'Strips without the NivoTalk watermark (per booth)', cost: p.watermark },
  ];

  return (
    <Sheet open={s.storeOpen} onClose={s.closeStore} title="Coins">
      <div className="grid gap-5">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#ffd86b] via-[#f7b733] to-[#f2a900] px-5 py-4 text-[#5a3b00] shadow-md">
          <p className="text-sm font-bold opacity-80">Your balance</p>
          <p className="font-display text-4xl font-bold">🪙 {s.coins}</p>
          <p className="mt-1 text-xs font-semibold opacity-80">Memories: {s.memorySlots} strips</p>
        </div>

        <section>
          <p className="mb-2 text-sm font-bold text-muted">Buy coins</p>
          <div className="grid grid-cols-3 gap-2">
            {s.packs.map((pk) => (
              <button
                key={pk.id}
                disabled={!s.canBuy || !!busy}
                onClick={() => buy(pk.id)}
                className="relative flex flex-col items-center gap-0.5 rounded-2xl border-2 border-[#f2c14e]/60 bg-[#fffaf0] px-2 py-3 text-[#5a3b00] transition active:scale-95 disabled:opacity-60"
              >
                {pk.tag && <span className="absolute -top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">{pk.tag}</span>}
                <span className="text-xl font-extrabold">🪙 {pk.coins}</span>
                <span className="text-sm font-bold">₹{pk.inr}</span>
              </button>
            ))}
          </div>
          {!s.canBuy && s.packs.length > 0 && <p className="mt-2 text-center text-xs font-semibold text-muted">Buying coins is coming soon 💛</p>}
          {s.canBuy && <p className="mt-2 text-center text-xs font-semibold text-muted">Test mode — no money is charged</p>}
        </section>

        <section>
          <p className="mb-2 text-sm font-bold text-muted">More Memories space</p>
          <div className="grid grid-cols-2 gap-2">
            {(['small', 'large'] as const).map((k) => (
              <button
                key={k}
                className="btn btn-soft h-auto flex-col !gap-0 py-2.5"
                disabled={!!busy}
                onClick={() => memory(k)}
              >
                <span className="font-extrabold">+{s.memoryPacks[k].slots} strips</span>
                <span className="text-xs font-bold opacity-80">🪙 {s.memoryPacks[k].cost}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-sm font-bold text-muted">What coins unlock</p>
          <div className="grid gap-1 rounded-2xl bg-surface-2 p-2">
            {unlocks.map((u) => (
              <div key={u.label} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                <span className="text-lg">{u.icon}</span>
                <span className="flex-1 font-semibold">{u.label}</span>
                <span className="font-extrabold text-[#8a5a00]">🪙 {u.cost}</span>
              </div>
            ))}
            <div className="flex items-center gap-3 px-2 py-1.5 text-sm">
              <Icon name="gift" size={18} className="ml-0.5 text-primary" />
              <span className="flex-1 font-semibold">Send coins to friends from their profile</span>
            </div>
          </div>
        </section>

        {s.history.length > 0 && (
          <section>
            <p className="mb-2 text-sm font-bold text-muted">Recent</p>
            <div className="grid gap-0.5">
              {s.history.slice(0, 12).map((h) => (
                <div key={h.id} className="flex items-center justify-between px-1 py-1 text-sm">
                  <span className="text-muted">{REASONS[h.reason] ?? h.reason}</span>
                  <span className={`font-extrabold ${h.delta > 0 ? 'text-[var(--success)]' : 'text-ink'}`}>
                    {h.delta > 0 ? '+' : ''}
                    {h.delta}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
