import type http from 'node:http';
import { Server } from 'socket.io';
import { userIdFromCookieHeader } from '../auth.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { audienceOf, isMember, memberIds } from '../model.js';
import { attachBooth } from './booth.js';
import { attachChill } from './chill.js';
import { addSocket, emitToUsers, removeSocket, setForeground, setIo, userRoom } from './hub.js';

export function createRealtime(server: http.Server, allowedOrigins: string[]) {
  const io = new Server(server, {
    path: '/socket.io',
    maxHttpBufferSize: 3e6, // booth frames are up to ~2.4 MB as data URLs
    cors: config.isProd && !config.clientOrigin ? undefined : { origin: allowedOrigins, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  setIo(io);

  // Sockets sign in with the same httpOnly session cookie as the API.
  io.use((socket, next) => {
    const uid = userIdFromCookieHeader(socket.handshake.headers.cookie);
    if (!uid) return next(new Error('unauthorized'));
    socket.data.userId = uid;
    next();
  });

  io.on('connection', async (socket) => {
    const userId: number = socket.data.userId;
    socket.join(userRoom(userId));
    attachBooth(socket);
    attachChill(socket);
    // The app says when it goes to the background, so phone pushes reach people who aren't looking.
    setForeground(userId, socket.id, true);
    socket.on('app:state', (payload: { active?: boolean }) => setForeground(userId, socket.id, payload?.active !== false));

    if (addSocket(userId)) {
      emitToUsers(await audienceOf(userId).catch(() => []), 'presence', { userId, online: true });
    }

    socket.on('typing', async (payload: { conversationId?: number; typing?: boolean }) => {
      const conversationId = Number(payload?.conversationId);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return;
      try {
        if (!(await isMember(conversationId, userId))) return;
        const others = (await memberIds(conversationId)).filter((id) => id !== userId);
        emitToUsers(others, 'typing', { conversationId, userId, typing: payload.typing !== false });
      } catch {
        /* ignore */
      }
    });

    socket.on('disconnect', async () => {
      setForeground(userId, socket.id, false);
      if (!removeSocket(userId)) return;
      try {
        const r = await query<{ last_seen_at: Date }>(
          'UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at',
          [userId],
        );
        emitToUsers(await audienceOf(userId), 'presence', {
          userId,
          online: false,
          lastSeenAt: r.rows[0]?.last_seen_at,
        });
      } catch (e) {
        console.error('[socket] presence update failed', e);
      }
    });
  });

  return io;
}
