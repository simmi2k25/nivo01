import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import { query } from '../db.js';
import { getUser, STICKER_ID, type PublicUser } from '../model.js';
import { findOpenRoom, ROOM_CODE } from '../routes/rooms.js';
import { getIo } from './hub.js';

const MAX_PEOPLE = 4;
const GET_READY_MS = 1200;
const AFTER_SHOT_MS = 1700;
const MAX_FRAME_CHARS = 2_500_000; // ≈ 1.8 MB of JPEG once base64-encoded

type Participant = { userId: number; socketId: string; joinedAt: number; user: PublicUser };
type Shoot = { id: string; shots: number; countdown: number; participantIds: number[]; timers: NodeJS.Timeout[] };
type Session = {
  code: string;
  hostId: number;
  shots: number;
  countdown: number;
  participants: Map<number, Participant>;
  shoot: Shoot | null;
  /** Frames for a shoot that just finished can still be arriving. */
  recentShootIds: string[];
};

const sessions = new Map<string, Session>();
const roomOf = (code: string) => `booth:${code}`;

export function liveParticipants(code: string) {
  const s = sessions.get(code);
  return s ? [...s.participants.values()].map((p) => ({ userId: p.userId, user: p.user })) : [];
}

/** The host runs the shoot; if they're away, the longest-present person does. */
function controllerId(s: Session) {
  if (s.participants.has(s.hostId)) return s.hostId;
  let best: Participant | null = null;
  for (const p of s.participants.values()) if (!best || p.joinedAt < best.joinedAt) best = p;
  return best?.userId ?? null;
}

function stateOf(s: Session) {
  return {
    code: s.code,
    hostId: s.hostId,
    controllerId: controllerId(s),
    shots: s.shots,
    countdown: s.countdown,
    participants: [...s.participants.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ userId: p.userId, user: p.user, joinedAt: p.joinedAt })),
    shooting: s.shoot ? { id: s.shoot.id, shots: s.shoot.shots, countdown: s.shoot.countdown } : null,
  };
}

const broadcastState = (s: Session) => getIo().to(roomOf(s.code)).emit('booth:state', stateOf(s));

function stopShoot(s: Session) {
  if (!s.shoot) return;
  s.shoot.timers.forEach(clearTimeout);
  s.recentShootIds = [s.shoot.id, ...s.recentShootIds].slice(0, 3);
  s.shoot = null;
}

export function closeBooth(code: string) {
  const s = sessions.get(code);
  const io = getIo();
  io.to(roomOf(code)).emit('booth:closed', { code, reason: 'ended' });
  io.in(roomOf(code)).socketsLeave(roomOf(code));
  if (s) {
    stopShoot(s);
    sessions.delete(code);
  }
}

function removeParticipant(code: string, userId: number, socketId: string) {
  const s = sessions.get(code);
  const p = s?.participants.get(userId);
  if (!s || !p || p.socketId !== socketId) return;
  s.participants.delete(userId);
  getIo().sockets.sockets.get(socketId)?.leave(roomOf(code));
  getIo().to(roomOf(code)).emit('booth:peer-left', { userId });
  if (!s.participants.size) {
    stopShoot(s);
    sessions.delete(code);
    return;
  }
  broadcastState(s);
}

function startShoot(s: Session) {
  const io = getIo();
  const room = roomOf(s.code);
  const shoot: Shoot = {
    id: crypto.randomUUID(),
    shots: s.shots,
    countdown: s.countdown,
    participantIds: [...s.participants.keys()],
    timers: [],
  };
  s.shoot = shoot;
  const at = (ms: number, fn: () => void) => shoot.timers.push(setTimeout(fn, ms));

  io.to(room).emit('booth:session-start', {
    sessionId: shoot.id,
    shots: shoot.shots,
    countdown: shoot.countdown,
    participantIds: shoot.participantIds,
  });
  broadcastState(s);

  const perShot = shoot.countdown * 1000 + AFTER_SHOT_MS;
  for (let shot = 0; shot < shoot.shots; shot++) {
    const base = GET_READY_MS + shot * perShot;
    for (let k = shoot.countdown; k >= 0; k--) {
      // remaining = 0 is the shutter moment.
      at(base + (shoot.countdown - k) * 1000, () =>
        io.to(room).emit('booth:countdown', { sessionId: shoot.id, shot, shots: shoot.shots, remaining: k }),
      );
    }
  }
  at(GET_READY_MS + shoot.shots * perShot, () => {
    io.to(room).emit('booth:session-end', { sessionId: shoot.id, participantIds: shoot.participantIds });
    stopShoot(s);
    broadcastState(s);
  });
}

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachBooth(socket: Socket) {
  const userId: number = socket.data.userId;
  const joined = new Set<string>();
  let lastReact = 0;

  const sessionFor = (raw: unknown) => {
    const parsed = ROOM_CODE.safeParse(raw);
    if (!parsed.success) return null;
    const s = sessions.get(parsed.data);
    return s && s.participants.get(userId)?.socketId === socket.id ? s : null;
  };

  socket.on('booth:join', async (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    try {
      const parsed = ROOM_CODE.safeParse(payload?.code);
      if (!parsed.success) return ack({ error: 'That room code doesn’t look right' });
      const code = parsed.data;
      const room = await findOpenRoom(code);
      if (!room) return ack({ error: 'This booth has ended or doesn’t exist' });

      let s = sessions.get(code);
      if (!s) {
        s = {
          code,
          hostId: room.host_id,
          shots: room.shots,
          countdown: room.countdown,
          participants: new Map(),
          shoot: null,
          recentShootIds: [],
        };
        sessions.set(code, s);
      }
      const existing = s.participants.get(userId);
      if (!existing && s.participants.size >= MAX_PEOPLE) return ack({ error: 'This booth is full (4 people max)' });
      if (existing && existing.socketId !== socket.id) {
        // Same person opened the booth somewhere else — that copy steps aside.
        const old = getIo().sockets.sockets.get(existing.socketId);
        old?.emit('booth:closed', { code, reason: 'joined-elsewhere' });
        old?.leave(roomOf(code));
        s.participants.delete(userId);
        getIo().to(roomOf(code)).emit('booth:peer-left', { userId });
      }
      const user = await getUser(userId);
      if (!user) return ack({ error: 'Please log in again' });
      if (!sessions.has(code)) sessions.set(code, s); // could have emptied meanwhile

      s.participants.set(userId, { userId, socketId: socket.id, joinedAt: Date.now(), user });
      joined.add(code);
      await socket.join(roomOf(code));
      socket.to(roomOf(code)).emit('booth:peer-joined', { userId, user });
      broadcastState(s);
      ack({ ok: true, state: stateOf(s) });
    } catch (e) {
      console.error('[booth] join failed', e);
      ack({ error: 'Couldn’t join the booth' });
    }
  });

  socket.on('booth:leave', (payload: { code?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s) return;
    joined.delete(s.code);
    removeParticipant(s.code, userId, socket.id);
  });

  // WebRTC offers / answers / ICE candidates, relayed only between members of the same booth.
  socket.on('booth:signal', (payload: { code?: string; to?: number; data?: unknown }) => {
    const s = sessionFor(payload?.code);
    const target = s?.participants.get(Number(payload?.to));
    if (!s || !target || target.userId === userId) return;
    const size = JSON.stringify(payload.data ?? null).length;
    if (size > 64_000) return;
    getIo().to(target.socketId).emit('booth:signal', { from: userId, data: payload.data });
  });

  socket.on('booth:settings', async (payload: { code?: string; shots?: number; countdown?: number }) => {
    const s = sessionFor(payload?.code);
    if (!s || s.shoot || controllerId(s) !== userId) return;
    const shots = Number(payload.shots ?? s.shots);
    const countdown = Number(payload.countdown ?? s.countdown);
    if (!Number.isInteger(shots) || shots < 1 || shots > 6) return;
    if (!Number.isInteger(countdown) || countdown < 1 || countdown > 10) return;
    s.shots = shots;
    s.countdown = countdown;
    broadcastState(s);
    await query('UPDATE booth_rooms SET shots = $2, countdown = $3 WHERE code = $1', [s.code, shots, countdown]).catch(
      () => {},
    );
  });

  socket.on('booth:start', (payload: { code?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s || s.shoot || controllerId(s) !== userId) return;
    startShoot(s);
  });

  socket.on('booth:cancel', (payload: { code?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s?.shoot || controllerId(s) !== userId) return;
    const id = s.shoot.id;
    stopShoot(s);
    getIo().to(roomOf(s.code)).emit('booth:session-cancel', { sessionId: id });
    broadcastState(s);
  });

  socket.on('booth:frame', (payload: { code?: string; sessionId?: string; shot?: number; data?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s) return;
    const { sessionId, shot, data } = payload;
    const known = s.shoot?.id === sessionId || s.recentShootIds.includes(String(sessionId));
    if (!known || !Number.isInteger(shot) || shot! < 0 || shot! > 5) return;
    if (typeof data !== 'string' || !data.startsWith('data:image/jpeg;base64,') || data.length > MAX_FRAME_CHARS) return;
    socket.to(roomOf(s.code)).emit('booth:frame', { from: userId, sessionId, shot, data });
  });

  socket.on('booth:react', (payload: { code?: string; stickerId?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s || typeof payload.stickerId !== 'string' || !STICKER_ID.test(payload.stickerId)) return;
    const now = Date.now();
    if (now - lastReact < 150) return;
    lastReact = now;
    getIo()
      .to(roomOf(s.code))
      .emit('booth:react', { from: userId, stickerId: payload.stickerId, id: crypto.randomUUID() });
  });

  socket.on('disconnect', () => {
    for (const code of joined) removeParticipant(code, userId, socket.id);
    joined.clear();
  });
}
