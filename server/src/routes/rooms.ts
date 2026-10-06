import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { getUser, isMember, postMessage } from '../model.js';
import { closeBooth, liveParticipants } from '../realtime/booth.js';

const router = Router();

// No look-alike characters (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'That room code doesn’t look right');

function newCode() {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export type RoomRow = {
  id: number;
  code: string;
  host_id: number;
  conversation_id: number | null;
  shots: number;
  countdown: number;
  status: 'open' | 'closed';
  created_at: Date;
  expires_at: Date;
};

export async function findOpenRoom(code: string) {
  return one<RoomRow>(`SELECT * FROM booth_rooms WHERE code = $1 AND status = 'open' AND expires_at > now()`, [code]);
}

async function serializeRoom(r: RoomRow) {
  return {
    code: r.code,
    hostId: r.host_id,
    host: await getUser(r.host_id),
    conversationId: r.conversation_id,
    shots: r.shots,
    countdown: r.countdown,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    participants: liveParticipants(r.code),
  };
}

async function postInvite(room: RoomRow, conversationId: number, userId: number) {
  if (!(await isMember(conversationId, userId))) throw fail(404, 'Chat not found');
  await postMessage({
    conversationId,
    senderId: userId,
    kind: 'booth_invite',
    body: 'Join my photobooth!',
    meta: { code: room.code, shots: room.shots, countdown: room.countdown, expiresAt: room.expires_at },
  });
}

router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      shots: z.number().int().min(1).max(6).default(4),
      countdown: z.number().int().min(1).max(10).default(3),
      conversationId: idParam.optional(),
    }),
    req.body,
  );
  let room: RoomRow | undefined;
  for (let i = 0; i < 5 && !room; i++) {
    room = await one<RoomRow>(
      `INSERT INTO booth_rooms (code, host_id, conversation_id, shots, countdown)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [newCode(), req.userId, body.conversationId ?? null, body.shots, body.countdown],
    );
  }
  if (!room) throw fail(500, 'Couldn’t create a room — try again');
  if (body.conversationId) await postInvite(room, body.conversationId, req.userId);
  res.status(201).json({ room: await serializeRoom(room) });
});

router.get('/mine', async (req, res) => {
  const r = await query<RoomRow>(
    `SELECT * FROM booth_rooms WHERE host_id = $1 AND status = 'open' AND expires_at > now()
     ORDER BY created_at DESC LIMIT 10`,
    [req.userId],
  );
  res.json({ rooms: await Promise.all(r.rows.map(serializeRoom)) });
});

router.get('/:code', async (req, res) => {
  const code = parse(ROOM_CODE, req.params.code);
  const room = await one<RoomRow>('SELECT * FROM booth_rooms WHERE code = $1', [code]);
  if (!room) throw fail(404, 'No booth with that code');
  const expired = room.status === 'closed' || new Date(room.expires_at) <= new Date();
  res.json({ room: { ...(await serializeRoom(room)), status: expired ? 'closed' : 'open' } });
});

router.post('/:code/invite', async (req, res) => {
  const code = parse(ROOM_CODE, req.params.code);
  const { conversationId } = parse(z.object({ conversationId: idParam }), req.body);
  const room = await findOpenRoom(code);
  if (!room) throw fail(404, 'This booth has ended');
  await postInvite(room, conversationId, req.userId);
  res.json({ ok: true });
});

router.post('/:code/close', async (req, res) => {
  const code = parse(ROOM_CODE, req.params.code);
  const room = await one<RoomRow>('SELECT * FROM booth_rooms WHERE code = $1', [code]);
  if (!room) throw fail(404, 'No booth with that code');
  if (room.host_id !== req.userId) throw fail(403, 'Only the host can end the booth');
  await query(`UPDATE booth_rooms SET status = 'closed' WHERE id = $1`, [room.id]);
  closeBooth(code);
  res.json({ ok: true });
});

export default router;
