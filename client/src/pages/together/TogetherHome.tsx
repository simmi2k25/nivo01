import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CoinButton } from '../../components/CoinStore';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import type { LiveBooth, LiveChill } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { useTogether } from '../../stores/together';
import { GroupAvatar } from '../Chats';
import { CoverArt, LiveBars } from './parts';

export default function TogetherHome() {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const { rooms, booths, loaded } = useTogether();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    useTogether.getState().load().catch(() => {});
  }, []);

  const whose = (host: { id: number; displayName: string } | null) => (host?.id === me.id ? 'Your' : host ? `${host.displayName}’s` : 'A');

  return (
    <div className="chill-bg relative h-full overflow-hidden">
      <div className="scroll-thin relative mx-auto h-full max-w-6xl overflow-y-auto px-5 pb-32 md:px-10 md:pb-10">
        <header className="safe-top flex items-start gap-4 pt-6 md:pt-12">
          <div className="min-w-0 flex-1">
            <h1 className="text-[40px] leading-[1.05] font-bold md:text-[52px]">Together</h1>
            <p className="mt-1 text-[17px] text-muted md:text-lg">Pick something to do with friends</p>
          </div>
          <span className="mt-2">
            <CoinButton />
          </span>
        </header>

        <div className="mt-6 grid gap-4 md:mt-8 md:grid-cols-2 md:gap-5">
          <ActivityCard
            icon="camera"
            title="Photobooth"
            text="Snap one strip together, up to 4 friends"
            cta="Start a booth"
            onClick={() => nav('/booth')}
            className="bg-surface"
            iconClass="bg-primary-soft text-primary-strong"
            buttonClass="bg-gradient-to-b from-[#6577dc] to-[#5669d2] shadow-[0_10px_22px_rgba(86,105,210,0.35)]"
          />
          <ActivityCard
            icon="music"
            title="Chill Room"
            text="Listen to full songs in sync and chat with friends"
            cta="Open a room"
            onClick={() => setOpening(true)}
            className="bg-gradient-to-br from-[#f6f8ff] to-[#e6efff] dark:from-surface dark:to-surface-2"
            iconClass="bg-[#d9e8ff] text-[#2f6fd6] dark:bg-primary-soft dark:text-primary-strong"
            buttonClass="bg-gradient-to-b from-[#3a7be0] to-[#2c6ad0] shadow-[0_10px_22px_rgba(44,106,208,0.35)]"
          />
        </div>

        <h2 className="mt-8 mb-3 text-[26px] font-bold md:mt-10">Live now</h2>
        {loaded && rooms.length === 0 && booths.length === 0 && (
          <p className="rounded-[24px] bg-surface/70 p-5 text-center text-muted">No one’s hanging out right now — open a room and invite friends.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((r) => (
            <RoomRow key={r.code} r={r} title={`${whose(r.host)} Chill Room`} onJoin={() => nav(`/chill/${r.code}`)} />
          ))}
          {booths.map((b) => (
            <BoothRow key={b.code} b={b} title={`${whose(b.host)} Photobooth`} onJoin={() => nav(`/booth/${b.code}`)} />
          ))}
        </div>
      </div>
      <OpenRoomSheet open={opening} onClose={() => setOpening(false)} />
    </div>
  );
}

function ActivityCard(p: { icon: 'camera' | 'music'; title: string; text: string; cta: string; onClick: () => void; className: string; iconClass: string; buttonClass: string }) {
  return (
    <section className={`anim-rise rounded-[32px] p-5 shadow-[var(--shadow)] md:p-8 ${p.className}`}>
      <div className="flex items-center gap-4 md:items-start">
        <span className={`grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[22px] md:h-[68px] md:w-[68px] ${p.iconClass}`}>
          <Icon name={p.icon} size={30} />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[26px] leading-tight font-bold">{p.title}</span>
          <span className="block leading-snug text-muted">{p.text}</span>
        </span>
      </div>
      <button className={`btn mt-5 h-14 w-full text-lg text-white md:w-auto md:px-8 ${p.buttonClass}`} onClick={p.onClick}>
        {p.cta}
      </button>
    </section>
  );
}

function RoomRow({ r, title, onJoin }: { r: LiveChill; title: string; onJoin: () => void }) {
  const n = r.listeners.length;
  return (
    <div className="flex items-center gap-3.5 rounded-[26px] bg-surface p-3 pr-3.5 shadow-[var(--shadow-sm)]">
      <span className="relative shrink-0">
        <CoverArt src={r.nowPlaying?.artwork} seed={r.code} className="h-[58px] w-[58px]" rounded="rounded-[18px]" />
        {r.nowPlaying?.playing && (
          <span className="absolute inset-0 grid place-items-center rounded-[18px] bg-black/20 text-white">
            <LiveBars className="!h-4" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold">{title}</span>
        <span className="block truncate text-muted">
          {n} listening{r.nowPlaying ? ` · ${r.nowPlaying.title}` : ''}
        </span>
      </span>
      <button className="h-12 shrink-0 rounded-full bg-[#e3eeff] px-5 font-display font-semibold text-[#2c5fb8] transition active:scale-95 dark:bg-primary-soft dark:text-primary-strong" onClick={onJoin}>
        Join
      </button>
    </div>
  );
}

function BoothRow({ b, title, onJoin }: { b: LiveBooth; title: string; onJoin: () => void }) {
  const n = b.people.length;
  const full = n >= 4;
  return (
    <div className="flex items-center gap-3.5 rounded-[26px] bg-surface p-3 pr-3.5 shadow-[var(--shadow-sm)]">
      <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[18px] bg-primary-soft text-primary-strong">
        <Icon name="camera" size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold">{title}</span>
        <span className="block truncate text-muted">{full ? 'Booth is full' : n === 1 ? 'Waiting for 1 more friend' : `${n} inside · room for ${4 - n} more`}</span>
      </span>
      <button className="h-12 shrink-0 rounded-full bg-primary-soft px-5 font-display font-semibold text-primary-strong transition active:scale-95 disabled:opacity-50" onClick={onJoin} disabled={full}>
        Join
      </button>
    </div>
  );
}

/** Open a Chill Room on its own (share the link) or for one of your chats (everyone there gets an invite). */
export function OpenRoomSheet({ open, onClose, conversationId }: { open: boolean; onClose: () => void; conversationId?: number }) {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [busy, setBusy] = useState<number | 'solo' | null>(null);

  async function start(cid?: number) {
    setBusy(cid ?? 'solo');
    try {
      const { room } = await api<{ room: { code: string } }>('/chill', { body: cid ? { conversationId: cid } : {} });
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
