import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getSocket, onSocket } from '../lib/socket';
import { Mesh, type Signal } from '../pages/booth/rtc';
import { Icon } from './Icon';
import { toast } from './Toast';

type Members = Record<number, { muted: boolean }>;
export type Voice = {
  /** off: just listening · asking: waiting on the mic permission · on: your mic is in the call */
  mic: 'off' | 'asking' | 'on';
  muted: boolean;
  /** Everyone in the table's voice room and whether their mic is muted. */
  members: Members;
  toggle: () => void;
};

let iceCache: RTCIceServer[] | null = null;
async function iceServers() {
  if (iceCache) return iceCache;
  const r = await api<{ iceServers: RTCIceServer[] }>('/rtc-config').catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
  return (iceCache = r.iceServers);
}

/**
 * Voice chat at a game table. Players join the table's voice room as listeners straight away, so they
 * hear whoever is talking; tapping the mic asks for the microphone and joins the call with it, after
 * which the same button mutes and unmutes. `room` is "<game>:<code>", or null when you can't talk here.
 */
export function useTableVoice(room: string | null): Voice {
  const [mic, setMic] = useState<Voice['mic']>('off');
  const [muted, setMuted] = useState(true);
  const [members, setMembers] = useState<Members>({});
  const mesh = useRef<Mesh | null>(null);
  const local = useRef<MediaStream | null>(null);
  const players = useRef(new Map<number, HTMLAudioElement>());
  const mutedRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!room) return;
    let alive = true;

    const onStream = (userId: number, stream: MediaStream | null) => {
      let el = players.current.get(userId);
      if (!stream) {
        el?.remove();
        players.current.delete(userId);
        return;
      }
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.setAttribute('playsinline', '');
        document.body.appendChild(el);
        players.current.set(userId, el);
      }
      if (el.srcObject !== stream) el.srcObject = stream;
      el.play().catch(() => {});
    };

    /** (Re)join the call with whatever we have: listeners first, the mic once it's allowed. */
    async function connect() {
      const s = getSocket();
      if (!s?.connected || !alive) return;
      const ice = await iceServers();
      if (!alive) return;
      mesh.current?.close();
      // Leave first so everyone drops the old connection before our new offers arrive.
      s.emit('voice:leave', { room });
      const m = new Mesh((to: number, data: Signal) => s.emit('voice:signal', { room, to, data }), ice, local.current, onStream, ['audio']);
      mesh.current = m;
      s.emit('voice:join', { room, muted: mutedRef.current }, (r: { ok?: boolean; peers?: number[] }) => {
        if (!alive || mesh.current !== m || !r?.ok) return;
        for (const id of r.peers ?? []) m.connectTo(id);
      });
    }
    connectRef.current = connect;

    const onSignal = (p: { room: string; from: number; data: Signal }) => p.room === room && mesh.current?.handleSignal(p.from, p.data);
    const onLeft = (p: { room: string; userId: number }) => p.room === room && mesh.current?.remove(p.userId);
    const onState = (p: { room: string; members: { userId: number; muted: boolean }[] }) => {
      if (p.room !== room) return;
      setMembers(Object.fromEntries(p.members.map((m) => [m.userId, { muted: m.muted }])));
    };
    let current: ReturnType<typeof getSocket> = null;
    const off = onSocket((s) => {
      current?.off('connect', connect);
      current = s;
      s.off('voice:signal', onSignal).on('voice:signal', onSignal);
      s.off('voice:peer-left', onLeft).on('voice:peer-left', onLeft);
      s.off('voice:state', onState).on('voice:state', onState);
      s.on('connect', connect);
      if (s.connected) connect();
    });
    // Phones only play sound after a tap: any tap on the page wakes up voices that were held back.
    const wake = () => players.current.forEach((el) => el.paused && el.play().catch(() => {}));
    document.addEventListener('pointerdown', wake);

    return () => {
      alive = false;
      off();
      document.removeEventListener('pointerdown', wake);
      const s = getSocket();
      current?.off('connect', connect);
      s?.emit('voice:leave', { room });
      s?.off('voice:signal', onSignal).off('voice:peer-left', onLeft).off('voice:state', onState);
      mesh.current?.close();
      mesh.current = null;
      local.current?.getTracks().forEach((t) => t.stop());
      local.current = null;
      players.current.forEach((el) => el.remove());
      players.current.clear();
      mutedRef.current = true;
      setMic('off');
      setMuted(true);
      setMembers({});
    };
  }, [room]);

  async function toggle() {
    if (!room || mic === 'asking') return;
    if (mic === 'off') {
      setMic('asking');
      try {
        local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        setMic('off');
        toast('Allow the microphone to talk with your friends', 'error');
        return;
      }
      mutedRef.current = false;
      setMuted(false);
      setMic('on');
      connectRef.current();
      return;
    }
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    getSocket()?.emit('voice:mute', { room, muted: next });
  }

  return { mic, muted, members, toggle };
}

/** The mic button: tap to join with your microphone, then tap to mute / unmute. */
export function VoiceButton({ voice, dark = false, className = '' }: { voice: Voice; dark?: boolean; className?: string }) {
  const live = voice.mic === 'on' && !voice.muted;
  const others = Object.values(voice.members).filter((m) => !m.muted).length - (live ? 1 : 0);
  const label = voice.mic === 'off' ? 'Turn on your mic' : voice.mic === 'asking' ? 'Starting your mic…' : voice.muted ? 'Unmute' : 'Mute';
  return (
    <button
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-90 md:h-12 md:w-12 ${
        live
          ? 'bg-[#2fbf71] text-white shadow-[0_6px_16px_rgba(47,191,113,0.45)]'
          : voice.mic === 'on'
            ? 'bg-[#ffe3ea] text-[#d93a58] ring-1 ring-[#f3b5c3] dark:bg-[#3a1f29]'
            : dark
              ? 'bg-white/10 text-white ring-1 ring-white/15 backdrop-blur'
              : 'bg-surface text-primary-strong shadow-[var(--shadow-sm)]'
      } ${className}`}
      onClick={voice.toggle}
      aria-label={label}
      aria-pressed={live}
      title={label}
    >
      {live && <span className="voice-ring pointer-events-none absolute inset-0 rounded-full" />}
      {voice.mic === 'asking' ? (
        <span className="anim-spin h-4 w-4 rounded-full border-2 border-current/30 border-t-current" />
      ) : (
        <Icon name={live ? 'mic' : 'micOff'} size={20} />
      )}
      {others > 0 && (
        <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#2fbf71] px-1 text-[11px] font-extrabold text-white ring-2 ring-[var(--bg)]" title={`${others} talking`}>
          {others}
        </span>
      )}
    </button>
  );
}

/** A tiny mic next to a player's name: green when they're live, struck through when muted. */
export function MicBadge({ voice, userId }: { voice: Voice; userId: number }) {
  const m = voice.members[userId];
  if (!m) return null;
  return (
    <span
      className={`inline-grid h-5 w-5 shrink-0 place-items-center rounded-full align-middle ${m.muted ? 'bg-black/5 text-faint dark:bg-white/10' : 'bg-[#2fbf71] text-white'}`}
      title={m.muted ? 'Muted' : 'Mic on'}
      aria-label={m.muted ? 'Muted' : 'Mic on'}
    >
      <Icon name={m.muted ? 'micOff' : 'mic'} size={12} strokeWidth={2.4} />
    </span>
  );
}
