import type { Server } from 'socket.io';

let io: Server | null = null;
/** Open socket count per user — presence flips only on 0→1 and 1→0. */
const sockets = new Map<number, number>();

export function setIo(server: Server) {
  io = server;
}

export function getIo() {
  if (!io) throw new Error('Socket.IO not initialised');
  return io;
}

export const userRoom = (id: number) => `user:${id}`;

export function emitToUsers(userIds: Iterable<number>, event: string, payload: unknown) {
  if (!io) return;
  const rooms = [...new Set(userIds)].map(userRoom);
  if (rooms.length) io.to(rooms).emit(event, payload);
}

export const isOnline = (id: number) => (sockets.get(id) ?? 0) > 0;

/** Returns true when this connection brought the user online. */
export function addSocket(id: number) {
  const n = (sockets.get(id) ?? 0) + 1;
  sockets.set(id, n);
  return n === 1;
}

/** Returns true when this disconnect took the user offline. */
export function removeSocket(id: number) {
  const n = (sockets.get(id) ?? 1) - 1;
  if (n <= 0) {
    sockets.delete(id);
    return true;
  }
  sockets.set(id, n);
  return false;
}
