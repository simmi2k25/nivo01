import express, { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { sniffImage } from '../images.js';
import { memberIds } from '../model.js';
import { emitToUsers } from '../realtime/hub.js';

const router = Router();
const MAX_BYTES = 6 * 1024 * 1024;

const photoUrl = (id: number) => `/api/photos/${id}`;

router.post('/', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
  const { roomCode } = parse(
    z.object({ roomCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/).optional() }),
    req.query,
  );
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || !buf.length) throw fail(400, 'No image received');
  const info = sniffImage(buf);
  if (!info) throw fail(415, 'Strips must be JPEG, PNG or WebP');
  if (info.width > 8000 || info.height > 8000) throw fail(413, 'That image is too large');
  const row = await one<{ id: number; created_at: Date }>(
    `INSERT INTO photos (owner_id, room_code, mime, size, data) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [req.userId, roomCode ?? null, info.mime, buf.length, buf],
  );
  res.status(201).json({
    photo: { id: row!.id, url: photoUrl(row!.id), createdAt: row!.created_at, size: buf.length, roomCode: roomCode ?? null },
  });
});

router.get('/', async (req, res) => {
  const r = await query<{ id: number; room_code: string | null; size: number; created_at: Date }>(
    'SELECT id, room_code, size, created_at FROM photos WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 300',
    [req.userId],
  );
  res.json({
    photos: r.rows.map((p) => ({ id: p.id, url: photoUrl(p.id), roomCode: p.room_code, size: p.size, createdAt: p.created_at })),
  });
});

router.get('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  // Visible to the owner, and to members of any chat it was shared in.
  const p = await one<{ mime: string; data: Buffer }>(
    `SELECT p.mime, p.data FROM photos p
      WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (
        SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
         WHERE m.kind = 'photo' AND m.meta->>'photoId' = $1::text AND cm.user_id = $2))`,
    [id, req.userId],
  );
  if (!p) throw fail(404, 'Photo not found');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(p.mime).send(p.data);
});

router.delete('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const p = await one('SELECT id FROM photos WHERE id = $1 AND owner_id = $2', [id, req.userId]);
  if (!p) throw fail(404, 'Photo not found');
  const removed = await query<{ id: number; conversation_id: number }>(
    `DELETE FROM messages WHERE kind = 'photo' AND meta->>'photoId' = $1::text RETURNING id, conversation_id`,
    [id],
  );
  await query('DELETE FROM photos WHERE id = $1', [id]);
  const byConv = new Map<number, number[]>();
  for (const m of removed.rows) byConv.set(m.conversation_id, [...(byConv.get(m.conversation_id) ?? []), m.id]);
  for (const [conversationId, messageIds] of byConv) {
    emitToUsers(await memberIds(conversationId), 'message:deleted', { conversationId, messageIds });
  }
  res.json({ ok: true });
});

export default router;
