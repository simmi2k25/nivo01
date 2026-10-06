import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { stickerUrl } from '../../lib/stickers';
import type { Room } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';

const SHOTS = [2, 3, 4, 6];
const TIMERS = [3, 5, 10];

export default function BoothHome() {
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [shots, setShots] = useState(4);
  const [countdown, setCountdown] = useState(3);
  const [sendTo, setSendTo] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Room[]>([]);

  useEffect(() => {
    api<{ rooms: Room[] }>('/rooms/mine')
      .then((r) => setMine(r.rooms))
      .catch(() => {});
  }, []);

  async function open() {
    setBusy(true);
    try {
      const { room } = await api<{ room: Room }>('/rooms', {
        body: { shots, countdown, ...(sendTo ? { conversationId: Number(sendTo) } : {}) },
      });
      nav(`/booth/${room.code}`);
    } catch (e) {
      toast(errorText(e), 'error');
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return toast('Room codes are 6 letters/numbers', 'error');
    nav(`/booth/${code}`);
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primary-soft opacity-70" aria-hidden="true" />
      <div className="scroll-thin relative mx-auto h-full max-w-xl overflow-y-auto px-5 pb-28 md:pb-8">
        {/* header */}
        <header className="safe-top flex items-center gap-4 pt-4">
          <span className="relative grid place-items-center">
            <span className="absolute h-[74px] w-[74px] rounded-full bg-primary-soft" />
            <img src="/brand/badge-256.png" alt="" className="relative h-14 w-14 rounded-full shadow-md" />
          </span>
          <div className="flex-1">
            <h1 className="text-[30px] leading-tight font-bold">Photobooth</h1>
            <p className="text-muted">Capture. Create. Keep.</p>
          </div>
          <Icon name="camera" size={40} strokeWidth={1.5} className="anim-float text-primary" />
        </header>

        {/* hero */}
        <div className="relative mt-2 flex h-44 items-end justify-center">
          <div className="absolute inset-x-6 bottom-0 h-36 rounded-[50%] bg-primary-soft/80" />
          <img src={stickerUrl('dino-15')} alt="" className="anim-float relative z-10 h-36 w-36 object-contain" />
          <div className="relative z-10 mb-6 ml-[-6px] flex">
            {['dino-01', 'berri-01', 'chatty-01'].map((s, i) => (
              <span
                key={s}
                className="anim-pop grid h-20 w-16 place-items-center rounded-md bg-white p-1 pb-3 shadow-md"
                style={{ transform: `rotate(${[-10, 3, 12][i]}deg) translateY(${[4, -8, 6][i]}px)`, marginLeft: i ? -12 : 0, animationDelay: `${0.1 + i * 0.1}s` }}
              >
                <span className="grid h-full w-full place-items-center rounded-sm bg-primary-soft">
                  <img src={stickerUrl(s)} alt="" className="h-10 w-10 object-contain" />
                </span>
              </span>
            ))}
          </div>
          <p className="font-hand anim-sway absolute top-2 right-0 rotate-12 text-xl leading-5 text-primary">
            Good
            <br />
            Vibes
            <br />
            Only ☺
          </p>
          <Icon name="sparkle" size={18} className="anim-twinkle absolute top-10 left-4 text-primary" />
          <Icon name="heart" size={20} className="anim-float absolute top-24 left-0 text-primary" />
        </div>

        {/* start card */}
        <section className="card anim-rise relative z-10 -mt-2 p-5">
          <h2 className="text-2xl font-bold">Start a booth</h2>
          <p className="mt-1 text-muted">Open a room, invite up to 3 friends, and everyone’s camera snaps together into one strip.</p>

          <Option icon="camera" title="Shots" hint="Number of photos per person">
            <div className="segmented w-full @min-[25rem]:w-auto [&>button]:flex-1 @min-[25rem]:[&>button]:flex-none">
              {SHOTS.map((v) => (
                <button key={v} aria-pressed={shots === v} onClick={() => setShots(v)}>
                  {v}
                </button>
              ))}
            </div>
          </Option>
          <Option icon="clock" title="Countdown" hint="Time before the photo">
            <div className="segmented w-full @min-[25rem]:w-auto [&>button]:flex-1 @min-[25rem]:[&>button]:flex-none">
              {TIMERS.map((v) => (
                <button key={v} aria-pressed={countdown === v} onClick={() => setCountdown(v)}>
                  {v}s
                </button>
              ))}
            </div>
          </Option>
          <div className="mt-3 rounded-[22px] border border-line p-3.5">
            <p className="flex items-center gap-3 font-bold">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-primary">
                <Icon name="userPlus" size={20} />
              </span>
              <span>
                Send the invite to <span className="font-semibold text-muted">(optional)</span>
              </span>
            </p>
            <div className="relative mt-2.5">
              <select value={sendTo} onChange={(e) => setSendTo(e.target.value)} className="field h-11 w-full cursor-pointer appearance-none pr-10 text-muted outline-none">
                <option value="">Don’t send — I’ll share the link</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {convTitle(c, me.id)}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={18} className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted" />
            </div>
          </div>
          <button className="btn btn-primary mt-4 h-14 w-full px-4 text-[17px]" onClick={open} disabled={busy}>
            <Icon name="camera" /> {busy ? 'Opening…' : 'Open booth room'} <Icon name="arrowRight" size={20} />
          </button>
        </section>

        {/* join */}
        <section className="card anim-rise delay-2 mt-4 p-5">
          <h2 className="text-lg font-bold">Have a code?</h2>
          <form onSubmit={join} className="mt-2 flex gap-2">
            <label className="field h-12 flex-1">
              <input
                placeholder="ABC234"
                value={joinCode}
                maxLength={6}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="font-display text-lg tracking-[0.25em]"
                autoCapitalize="characters"
              />
            </label>
            <button className="btn btn-soft h-12" disabled={joinCode.trim().length !== 6}>
              Join
            </button>
          </form>
        </section>

        {mine.length > 0 && (
          <section className="anim-rise delay-3 mt-4">
            <h2 className="px-1 pb-2 text-xs font-bold tracking-wide text-faint uppercase">Your open rooms</h2>
            <div className="grid grid-cols-1 gap-2">
              {mine.map((r) => (
                <button key={r.code} onClick={() => nav(`/booth/${r.code}`)} className="card flex items-center gap-3 !rounded-2xl px-4 py-3 text-left">
                  <Icon name="camera" className="text-primary" />
                  <span className="flex-1">
                    <b className="font-display tracking-widest">{r.code}</b>
                    <span className="block text-xs text-muted">
                      {r.shots} shots · {r.countdown}s · {r.participants.length} inside
                    </span>
                  </span>
                  <Icon name="chevronRight" className="text-faint" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Option({ icon, title, hint, children }: { icon: 'camera' | 'clock'; title: string; hint: string; children: React.ReactNode }) {
  // Narrow cards (phones, large text): title on top, choices full-width below. Wide cards: one row.
  return (
    <div className="@container mt-3 rounded-[22px] border border-line p-3.5">
      <div className="flex flex-col gap-3 @min-[25rem]:flex-row @min-[25rem]:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            <Icon name={icon} size={21} />
          </span>
          <span className="min-w-0">
            <span className="block font-bold">{title}</span>
            <span className="block text-xs leading-snug text-muted">{hint}</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
