import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Socket } from 'socket.io-client';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Loader } from '../../components/Loader';
import { Sheet } from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { convTitle } from '../../lib/conv';
import { loadImage } from '../../lib/image';
import { publicOrigin } from '../../lib/native';
import { copyText } from '../../lib/share';
import { getSocket } from '../../lib/socket';
import { stickerUrl } from '../../lib/stickers';
import type { Room, User } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { useChat } from '../../stores/chat';
import { GroupAvatar } from '../Chats';
import type { Shots } from './composer';
import { Mesh } from './rtc';
import { StripEditor } from './StripEditor';

type BoothState = {
  code: string;
  hostId: number;
  controllerId: number | null;
  shots: number;
  countdown: number;
  participants: { userId: number; user: User; joinedAt: number }[];
  shooting: { id: string; shots: number; countdown: number } | null;
};
type Session = { sessionId: string; shots: number; countdown: number; participantIds: number[] };
type Reaction = { id: string; stickerId: string; x: number; r: number };

const REACTIONS = ['dino-03', 'berri-08', 'chatty-03', 'pepo-07', 'pomi-03', 'dino-07'];
const FRAME_W = 960;
const FRAME_H = 720;
const COLLECT_TIMEOUT = 6000;

export default function BoothRoom() {
  const { code: rawCode = '' } = useParams();
  const code = rawCode.toUpperCase();
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;

  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<BoothState | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [remote, setRemote] = useState<Record<number, MediaStream>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [count, setCount] = useState<{ shot: number; shots: number; remaining: number } | null>(null);
  const [flash, setFlash] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [editor, setEditor] = useState<{ shots: Shots; names: string[] } | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [invite, setInvite] = useState(false);

  const meshRef = useRef<Mesh | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const frames = useRef(new Map<string, string>()); // `${shot}:${userId}` → JPEG data URL
  const sessionRef = useRef<Session | null>(null);
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------------------------------------------------------------- room info
  useEffect(() => {
    api<{ room: Room }>(`/rooms/${code}`)
      .then(({ room }) => (room.status === 'open' ? setRoom(room) : setError('This booth has ended.')))
      .catch((e) => setError(errorText(e)));
  }, [code]);

  // ---------------------------------------------------------------- camera
  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      return stream;
    } catch (e) {
      const name = (e as DOMException).name;
      setCamError(name === 'NotAllowedError' ? 'Camera access was blocked — allow it in your browser settings to join on video.' : 'No camera found. You can still watch and decorate.');
      return null;
    }
  }, []);

  // ---------------------------------------------------------------- join + realtime
  useEffect(() => {
    if (!room) return;
    const socket = getSocket();
    if (!socket) return;
    let disposed = false;
    let stream: MediaStream | null = null;

    const onStream = (userId: number, s: MediaStream | null) =>
      setRemote((r) => {
        const next = { ...r };
        if (s) next[userId] = s;
        else delete next[userId];
        return next;
      });

    const join = async (s: Socket) => {
      const ack = await s.emitWithAck('booth:join', { code });
      if (disposed) return;
      if (ack?.error) {
        setError(ack.error);
        return;
      }
      setState(ack.state);
      meshRef.current?.close();
      const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/rtc-config').catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
      const mesh = new Mesh(code, s, iceServers, localRef.current, onStream);
      meshRef.current = mesh;
      for (const p of (ack.state as BoothState).participants) if (p.userId !== me.id) mesh.connectTo(p.userId);
    };

    (async () => {
      stream = await startCamera(facingRef.current);
      if (disposed) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = stream;
      setLocal(stream);
      await join(socket);
    })();

    const handlers: Record<string, (...a: any[]) => void> = {
      connect: () => join(socket), // re-join after a reconnect
      'booth:state': (st: BoothState) => setState(st),
      'booth:peer-joined': () => {
        /* they call us; the mesh answers their offer */
      },
      'booth:peer-left': ({ userId }: { userId: number }) => meshRef.current?.remove(userId),
      'booth:signal': ({ from, data }: { from: number; data: any }) => meshRef.current?.handleSignal(from, data),
      'booth:session-start': (s: Session) => {
        frames.current.clear();
        sessionRef.current = s;
        setSession(s);
        setEditor(null);
        setCollecting(false);
      },
      'booth:countdown': (e: { sessionId: string; shot: number; shots: number; remaining: number }) => {
        if (e.sessionId !== sessionRef.current?.sessionId) return;
        setCount({ shot: e.shot, shots: e.shots, remaining: e.remaining });
        if (e.remaining === 0) capture(socket, e.sessionId, e.shot);
      },
      'booth:frame': ({ from, sessionId, shot, data }: { from: number; sessionId: string; shot: number; data: string }) => {
        if (sessionId === sessionRef.current?.sessionId) frames.current.set(`${shot}:${from}`, data);
      },
      'booth:session-end': ({ sessionId }: { sessionId: string }) => {
        if (sessionId !== sessionRef.current?.sessionId) return;
        setCount(null);
        setCollecting(true);
        waitForFrames(sessionRef.current!).then(buildEditor);
      },
      'booth:session-cancel': () => {
        sessionRef.current = null;
        setSession(null);
        setCount(null);
        toast('Shoot cancelled');
      },
      'booth:react': ({ id, stickerId }: { id: string; stickerId: string }) => {
        const r: Reaction = { id, stickerId, x: 10 + Math.random() * 75, r: Math.round((Math.random() - 0.5) * 30) };
        setReactions((list) => [...list.slice(-12), r]);
        setTimeout(() => setReactions((list) => list.filter((x) => x.id !== id)), 2600);
      },
      'booth:closed': ({ reason }: { reason: string }) => {
        toast(reason === 'joined-elsewhere' ? 'You opened this booth somewhere else' : 'The host ended the booth');
        nav('/booth');
      },
    };
    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);

    return () => {
      disposed = true;
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
      socket.emit('booth:leave', { code });
      meshRef.current?.close();
      meshRef.current = null;
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    };
  }, [room, code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (localVideo.current && local) localVideo.current.srcObject = local;
  }, [local, editor]);

  // ---------------------------------------------------------------- shoot
  function capture(socket: Socket, sessionId: string, shot: number) {
    setFlash((n) => n + 1);
    const video = localVideo.current;
    if (!video || !localRef.current || !video.videoWidth) return;
    // Draw the camera as the mirrored preview people saw, cropped to 4:3.
    const c = document.createElement('canvas');
    c.width = FRAME_W;
    c.height = FRAME_H;
    const ctx = c.getContext('2d')!;
    const s = Math.max(FRAME_W / video.videoWidth, FRAME_H / video.videoHeight);
    const w = video.videoWidth * s;
    const h = video.videoHeight * s;
    if (facingRef.current === 'user') {
      ctx.translate(FRAME_W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h);
    const data = c.toDataURL('image/jpeg', 0.88);
    frames.current.set(`${shot}:${me.id}`, data);
    socket.emit('booth:frame', { code, sessionId, shot, data });
  }

  function waitForFrames(s: Session) {
    const need = s.shots * s.participantIds.length;
    return new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (frames.current.size >= need || Date.now() - started > COLLECT_TIMEOUT) resolve();
        else setTimeout(tick, 150);
      };
      tick();
    });
  }

  async function buildEditor() {
    const s = sessionRef.current;
    if (!s) return;
    const people = s.participantIds;
    const shots: Shots = [];
    for (let i = 0; i < s.shots; i++) {
      const row: HTMLImageElement[] = [];
      for (const uid of people) {
        const data = frames.current.get(`${i}:${uid}`);
        if (data) row.push(await loadImage(data));
      }
      if (row.length) shots.push(row);
    }
    setCollecting(false);
    setSession(null);
    if (!shots.length) {
      toast('No photos arrived — try again', 'error');
      return;
    }
    const byId = new Map(stateRef.current?.participants.map((p) => [p.userId, p.user.displayName]) ?? []);
    if (!byId.has(me.id)) byId.set(me.id, me.displayName);
    setEditor({ shots, names: people.map((id) => byId.get(id) ?? '').filter(Boolean) });
  }

  // ---------------------------------------------------------------- controls
  const socket = getSocket();
  const isController = state?.controllerId === me.id;
  const isHost = state?.hostId === me.id;
  const shooting = !!state?.shooting || !!session;

  async function flip() {
    const next = facing === 'user' ? 'environment' : 'user';
    const s = await startCamera(next);
    if (!s) return;
    const old = localRef.current;
    localRef.current = s;
    meshRef.current?.setLocal(s);
    await meshRef.current?.replaceVideo(s.getVideoTracks()[0]);
    old?.getTracks().forEach((t) => t.stop());
    setFacing(next);
    setLocal(s);
  }

  function leave() {
    nav('/booth');
  }

  async function endBooth() {
    if (!confirm('End the booth for everyone?')) return;
    await api(`/rooms/${code}/close`, { method: 'POST' }).catch((e) => toast(errorText(e), 'error'));
  }

  // ---------------------------------------------------------------- render
  if (error) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="anim-rise">
          <img src={stickerUrl('dino-18')} alt="" className="mx-auto h-28 w-28 object-contain" />
          <p className="mt-2 font-semibold">{error}</p>
          <button className="btn btn-primary btn-sm mt-4" onClick={() => nav('/booth')}>
            Back to Photobooth
          </button>
        </div>
      </div>
    );
  }
  if (!room || !state) return <div className="h-full bg-[#141933]"><Loader compact /></div>;

  if (editor) {
    return (
      <StripEditor
        shots={editor.shots}
        names={editor.names}
        roomCode={code}
        conversationId={room.conversationId}
        onAgain={() => setEditor(null)}
        onLeave={leave}
      />
    );
  }

  const tiles = state.participants.map((p) => ({ ...p, stream: p.userId === me.id ? local : (remote[p.userId] ?? null) }));
  const n = tiles.length;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#141933] text-white">
      {/* top bar */}
      <div className="safe-top z-10 flex items-center gap-2 px-3 py-2">
        <button className="icon-btn !text-white hover:!bg-white/15" onClick={leave} aria-label="Leave booth">
          <Icon name="back" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-display leading-tight font-semibold">Photobooth</p>
          <p className="text-xs opacity-75">
            Code <b className="tracking-widest">{code}</b> · {n}/4 here
          </p>
        </div>
        <button className="btn btn-sm !h-9 bg-white/15 text-white" onClick={() => setInvite(true)}>
          <Icon name="userPlus" size={17} /> Invite
        </button>
        {local && (
          <button className="icon-btn !text-white hover:!bg-white/15" onClick={flip} disabled={shooting} aria-label="Flip camera">
            <Icon name="flip" />
          </button>
        )}
      </div>

      {/* video grid */}
      <div className={`grid min-h-0 flex-1 gap-2 px-2 ${n === 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
        {tiles.map((t) => (
          <VideoTile key={t.userId} user={t.user} stream={t.stream} mine={t.userId === me.id} mirror={t.userId === me.id && facing === 'user'} videoRef={t.userId === me.id ? localVideo : undefined} host={t.userId === state.hostId} />
        ))}
      </div>
      {camError && <p className="mx-3 mt-2 rounded-2xl bg-white/10 px-3 py-2 text-center text-xs">{camError}</p>}

      {/* countdown, flash, reactions */}
      {count && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          {count.remaining > 0 && (
            <span key={`${count.shot}-${count.remaining}`} className="font-display text-[140px] leading-none font-bold drop-shadow-[0_6px_30px_rgba(111,132,222,0.9)]" style={{ animation: 'count-pop 1s ease-out both' }}>
              {count.remaining}
            </span>
          )}
          <span className="absolute top-20 rounded-full bg-black/35 px-4 py-1.5 text-sm font-bold">
            Shot {count.shot + 1} of {count.shots}
          </span>
        </div>
      )}
      {session && !count && !collecting && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <span className="anim-pop font-display rounded-full bg-black/35 px-6 py-3 text-2xl font-semibold">Get ready! 📸</span>
        </div>
      )}
      {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0 z-30 bg-white" style={{ animation: 'flash 0.6s ease-out both' }} />}
      {collecting && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[#141933]/80">
          <div className="text-center">
            <Loader compact />
            <p className="-mt-4 font-semibold">Developing your strip…</p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-40 z-20 h-0">
        {reactions.map((r) => (
          <img key={r.id} src={stickerUrl(r.stickerId)} alt="" className="absolute h-20 w-20 object-contain" style={{ left: `${r.x}%`, ['--r' as string]: `${r.r}deg`, animation: 'float-up 2.6s ease-out both' }} />
        ))}
      </div>

      {/* bottom controls */}
      <div className="safe-bottom z-10 px-3 pt-2 pb-3">
        <div className="mb-2 flex justify-center gap-1.5">
          {REACTIONS.map((id) => (
            <button key={id} onClick={() => socket?.emit('booth:react', { code, stickerId: id })} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-90" aria-label="Send reaction">
              <img src={stickerUrl(id)} alt="" className="h-8 w-8 object-contain" />
            </button>
          ))}
        </div>
        {isController ? (
          <div className="rounded-[24px] bg-white/10 p-3">
            {!shooting && (
              <div className="mb-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold">
                <span className="flex items-center gap-2">
                  Shots
                  <span className="segmented !bg-white/10">
                    {[1, 2, 3, 4, 6].map((v) => (
                      <button key={v} className="!h-7 !min-w-7 !px-2 !text-white/80" aria-pressed={state.shots === v} onClick={() => socket?.emit('booth:settings', { code, shots: v })}>
                        {v}
                      </button>
                    ))}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  Timer
                  <span className="segmented !bg-white/10">
                    {[3, 5, 10].map((v) => (
                      <button key={v} className="!h-7 !min-w-7 !px-2 !text-white/80" aria-pressed={state.countdown === v} onClick={() => socket?.emit('booth:settings', { code, countdown: v })}>
                        {v}s
                      </button>
                    ))}
                  </span>
                </span>
              </div>
            )}
            <div className="flex gap-2">
              {shooting ? (
                <button className="btn flex-1 bg-white/15 text-white" onClick={() => socket?.emit('booth:cancel', { code })}>
                  Cancel shoot
                </button>
              ) : (
                <button className="btn btn-primary flex-1" onClick={() => socket?.emit('booth:start', { code })}>
                  <Icon name="camera" size={20} /> Start · {state.shots} shot{state.shots > 1 ? 's' : ''}
                </button>
              )}
              {isHost && !shooting && (
                <button className="btn bg-white/10 px-4 text-white" onClick={endBooth}>
                  End
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-[24px] bg-white/10 px-4 py-3.5 text-center text-sm font-semibold">
            {shooting ? 'Smile! 📸' : `Waiting for ${state.participants.find((p) => p.userId === state.controllerId)?.user.displayName ?? 'the host'} to start · ${state.shots} shots, ${state.countdown}s timer`}
          </p>
        )}
      </div>

      <InviteSheet open={invite} onClose={() => setInvite(false)} code={code} />
    </div>
  );
}

function VideoTile({ user, stream, mine, mirror, videoRef, host }: { user: User; stream: MediaStream | null; mine: boolean; mirror: boolean; videoRef?: React.RefObject<HTMLVideoElement | null>; host: boolean }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream, ref]);
  return (
    <div className="anim-pop relative min-h-0 overflow-hidden rounded-[22px] bg-[#232a52]">
      {stream ? (
        <video ref={ref} autoPlay playsInline muted={mine} className="h-full w-full object-cover" style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
      ) : (
        <div className="grid h-full place-items-center">
          <div className="grid justify-items-center gap-2 text-center">
            <Avatar user={user} size={72} />
            <span className="text-xs opacity-70">{mine ? 'Camera off' : 'Connecting…'}</span>
          </div>
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs font-bold backdrop-blur">
        {host && <Icon name="star" size={12} fill="currentColor" />}
        {mine ? 'You' : user.displayName}
      </span>
    </div>
  );
}

function InviteSheet({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const [sent, setSent] = useState<number[]>([]);
  const link = `${publicOrigin()}/booth/${code}`;

  return (
    <Sheet open={open} onClose={onClose} title="Invite to the booth">
      <div className="rounded-2xl bg-primary-soft p-4 text-center">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">Room code</p>
        <p className="font-display text-4xl font-bold tracking-[0.2em] text-primary-strong">{code}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-soft btn-sm" onClick={async () => toast((await copyText(link)) ? 'Link copied' : link)}>
          <Icon name="link" size={17} /> Copy link
        </button>
        <button
          className="btn btn-soft btn-sm"
          onClick={() => (navigator.share ? navigator.share({ title: 'Join my NivoTalk photobooth', url: link }).catch(() => {}) : copyText(link).then(() => toast('Link copied')))}
        >
          <Icon name="share" size={17} /> Share
        </button>
      </div>
      <p className="mt-4 mb-1 text-xs font-bold tracking-wide text-faint uppercase">Send to a chat</p>
      {conversations.length === 0 && <p className="py-3 text-sm text-muted">No chats yet.</p>}
      {conversations.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
          <GroupAvatar c={c} meId={me.id} size={40} />
          <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
          <button
            className={`btn btn-sm ${sent.includes(c.id) ? 'btn-soft' : 'btn-primary'}`}
            disabled={sent.includes(c.id)}
            onClick={() =>
              api(`/rooms/${code}/invite`, { body: { conversationId: c.id } })
                .then(() => setSent((s) => [...s, c.id]))
                .catch((e) => toast(errorText(e), 'error'))
            }
          >
            {sent.includes(c.id) ? 'Sent' : 'Send'}
          </button>
        </div>
      ))}
    </Sheet>
  );
}
