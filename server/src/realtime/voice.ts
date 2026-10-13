import type { Socket } from 'socket.io';
import { getIo } from './hub.js';

/**
 * Voice chat for game tables. Audio goes phone-to-phone over WebRTC; the server only keeps track of who
 * is in each table's voice room and relays the connection messages between them. Each game decides who
 * may talk at its tables (its seated players).
 */

type Member = { socketId: string; muted: boolean };

/** "cb:ABC234" → may this user join? Registered by each game. */
const gates = new Map<string, (code: string, userId: number) => boolean>();
const rooms = new Map<string, Map<number, Member>>();

export function registerVoiceGame(prefix: string, mayJoin: (code: string, userId: number) => boolean) {
  gates.set(prefix, mayJoin);
}

function allowed(room: unknown, userId: number): room is string {
  if (typeof room !== 'string') return false;
  const m = /^([a-z]+):([A-HJ-NP-Z2-9]{6})$/.exec(room);
  const gate = m && gates.get(m[1]);
  return !!gate && gate(m![2], userId);
}

const roomKey = (room: string) => `voice:${room}`;

function sendState(room: string) {
  const members = rooms.get(room);
  const list = members ? [...members].map(([userId, m]) => ({ userId, muted: m.muted })) : [];
  getIo().to(roomKey(room)).emit('voice:state', { room, members: list });
}

function leave(socket: Socket, room: string, userId: number) {
  const members = rooms.get(room);
  if (members?.get(userId)?.socketId !== socket.id) return;
  members.delete(userId);
  if (!members.size) rooms.delete(room);
  socket.leave(roomKey(room));
  getIo().to(roomKey(room)).emit('voice:peer-left', { room, userId });
  sendState(room);
}

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachVoice(socket: Socket) {
  const userId: number = socket.data.userId;
  const joined = new Set<string>();

  /** Join a table's voice room: you get back who's already there (you call them), and they hear you arrived. */
  socket.on('voice:join', async (payload: { room?: string; muted?: boolean }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const room = payload?.room;
    if (!allowed(room, userId)) return ack({ error: 'Only players at this table can talk' });
    let members = rooms.get(room);
    if (!members) rooms.set(room, (members = new Map()));
    // The same person on a second phone: the old one steps out of the call.
    const old = members.get(userId);
    if (old && old.socketId !== socket.id) {
      getIo().sockets.sockets.get(old.socketId)?.leave(roomKey(room));
      getIo().to(roomKey(room)).emit('voice:peer-left', { room, userId });
    }
    const others = [...members.keys()].filter((id) => id !== userId);
    members.set(userId, { socketId: socket.id, muted: payload?.muted !== false });
    joined.add(room);
    await socket.join(roomKey(room));
    ack({ ok: true, peers: others });
    sendState(room);
  });

  socket.on('voice:leave', (payload: { room?: string }) => {
    if (typeof payload?.room !== 'string' || !joined.has(payload.room)) return;
    joined.delete(payload.room);
    leave(socket, payload.room, userId);
  });

  socket.on('voice:mute', (payload: { room?: string; muted?: boolean }) => {
    const m = typeof payload?.room === 'string' ? rooms.get(payload.room)?.get(userId) : undefined;
    if (!m || m.socketId !== socket.id) return;
    m.muted = payload.muted !== false;
    sendState(payload.room!);
  });

  // Offers / answers / ICE candidates, relayed only between people in the same voice room.
  socket.on('voice:signal', (payload: { room?: string; to?: number; data?: unknown }) => {
    const members = typeof payload?.room === 'string' ? rooms.get(payload.room) : undefined;
    if (!members || members.get(userId)?.socketId !== socket.id) return;
    const target = members.get(Number(payload.to));
    if (!target || JSON.stringify(payload.data ?? null).length > 64_000) return;
    getIo().to(target.socketId).emit('voice:signal', { room: payload.room, from: userId, data: payload.data });
  });

  socket.on('disconnect', () => {
    for (const room of joined) leave(socket, room, userId);
    joined.clear();
  });
}
