import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { getUser, isMember, postMessage } from '../model.js';
import { pushToUsers } from '../push.js';
import { liveBooths } from '../realtime/booth.js';
import { CHILL_CODE, closeChill, findOpenChill, liveChillRooms, notifyTogether, type ChillRow } from '../realtime/chill.js';
import { isForeground } from '../realtime/hub.js';

const router = Router();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

async function serialize(r: ChillRow) {
  const live = liveChillRooms().find((x) => x.code === r.code);
  return {
    code: r.code,
    hostId: r.host_id,
    host: await getUser(r.host_id),
    conversationId: r.conversation_id,
    status: r.status === 'open' && new Date(r.expires_at) > new Date() ? 'open' : 'closed',
    listeners: live?.listeners ?? [],
    nowPlaying: live?.nowPlaying ?? null,
  };
}

/** "Maya started a Chill Room" in the chat, plus a phone push for anyone not looking. */
async function announce(room: ChillRow, conversationId: number, userId: number, verb: 'started' | 'invited you to') {
  if (!(await isMember(conversationId, userId))) throw fail(404, 'Chat not found');
  const me = await getUser(userId);
  const name = me?.displayName ?? 'Someone';
  await postMessage({
    conversationId,
    senderId: null,
    kind: 'system',
    body: verb === 'started' ? `${name} started a Chill Room 🎧` : `${name} invited everyone to a Chill Room 🎧`,
    meta: { event: 'chill', code: room.code, by: userId },
  });
  const members = await query<{ user_id: number }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND NOT muted',
    [conversationId, userId],
  );
  const away = members.rows.map((m) => m.user_id).filter((id) => !isForeground(id));
  if (away.length) {
    pushToUsers(away, { title: name, body: 'started a Chill Room — come listen together 🎧', to: `/chill/${room.code}`, tag: `chill:${room.code}` }).catch(
      (e) => console.error('[push] chill', e.message),
    );
  }
}

router.post('/', async (req, res) => {
  const body = parse(z.object({ conversationId: idParam.optional() }), req.body ?? {});
  if (body.conversationId && !(await isMember(body.conversationId, req.userId))) throw fail(404, 'Chat not found');
  // One open room per chat: starting again from the same chat takes you to the one already going.
  if (body.conversationId) {
    const existing = await one<ChillRow>(
      `SELECT * FROM chill_rooms WHERE conversation_id = $1 AND status = 'open' AND expires_at > now() ORDER BY id DESC LIMIT 1`,
      [body.conversationId],
    );
    if (existing) return res.json({ room: await serialize(existing) });
  }
  let room: ChillRow | undefined;
  for (let i = 0; i < 5 && !room; i++) {
    room = await one<ChillRow>(
      `INSERT INTO chill_rooms (code, host_id, conversation_id) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [newCode(), req.userId, body.conversationId ?? null],
    );
  }
  if (!room) throw fail(500, 'Couldn’t open a room — try again');
  if (body.conversationId) await announce(room, body.conversationId, req.userId, 'started');
  res.status(201).json({ room: await serialize(room) });
});

/** What friends are doing right now: Chill Rooms and photobooths with people in them. */
router.get('/live', async (req, res) => {
  const me = req.userId;
  const friends = await query<{ id: number }>(
    'SELECT friend_id AS id FROM friendships WHERE user_id = $1 UNION SELECT user_id FROM friendships WHERE friend_id = $1',
    [me],
  );
  const chats = await query<{ id: number }>('SELECT conversation_id AS id FROM conversation_members WHERE user_id = $1', [me]);
  const friendIds = new Set(friends.rows.map((r) => r.id));
  const chatIds = new Set(chats.rows.map((r) => r.id));
  const visible = (hostId: number, conversationId: number | null, people: number[]) =>
    hostId === me ||
    people.includes(me) ||
    (conversationId ? chatIds.has(conversationId) : friendIds.has(hostId) || people.some((id) => friendIds.has(id)));

  const rooms = liveChillRooms().filter((r) => visible(r.hostId, r.conversationId, r.listeners.map((l) => l.id)));
  const booths = liveBooths().filter((b) => visible(b.hostId, b.conversationId, b.participants.map((p) => p.userId)));
  const hosts = new Map<number, Awaited<ReturnType<typeof getUser>>>();
  for (const id of new Set([...rooms.map((r) => r.hostId), ...booths.map((b) => b.hostId)])) hosts.set(id, await getUser(id));
  res.json({
    rooms: rooms.map((r) => ({ ...r, host: hosts.get(r.hostId) })),
    booths: booths.map((b) => ({ code: b.code, hostId: b.hostId, host: hosts.get(b.hostId), conversationId: b.conversationId, people: b.participants.map((p) => p.user) })),
  });
});

router.get('/:code', async (req, res) => {
  const code = parse(CHILL_CODE, req.params.code);
  const room = await one<ChillRow>('SELECT * FROM chill_rooms WHERE code = $1', [code]);
  if (!room) throw fail(404, 'No Chill Room with that code');
  res.json({ room: await serialize(room) });
});

router.post('/:code/invite', async (req, res) => {
  const code = parse(CHILL_CODE, req.params.code);
  const { conversationId } = parse(z.object({ conversationId: idParam }), req.body);
  const room = await findOpenChill(code);
  if (!room) throw fail(404, 'This Chill Room has closed');
  await announce(room, conversationId, req.userId, 'invited you to');
  res.json({ ok: true });
});

router.post('/:code/close', async (req, res) => {
  const code = parse(CHILL_CODE, req.params.code);
  const room = await one<ChillRow>('SELECT * FROM chill_rooms WHERE code = $1', [code]);
  if (!room) throw fail(404, 'No Chill Room with that code');
  if (room.host_id !== req.userId) throw fail(403, 'Only the host can close the room');
  await query(`UPDATE chill_rooms SET status = 'closed' WHERE id = $1`, [room.id]);
  closeChill(code);
  notifyTogether(room.host_id, room.conversation_id);
  res.json({ ok: true });
});

export default router;
