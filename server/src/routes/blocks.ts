import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { conversationsFor, publicUser, USER_COLS, type UserRow } from '../model.js';
import { emitToUsers } from '../realtime/hub.js';

const router = Router();

/** Re-sends the direct chat between two people (if any) so both screens show the new block state. */
async function refreshDirectChat(a: number, b: number) {
  const key = [a, b].sort((x, y) => x - y).join(':');
  const conv = await one<{ id: number }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
  if (!conv) return;
  for (const uid of [a, b]) {
    const [c] = await conversationsFor(uid, conv.id);
    if (c) emitToUsers([uid], 'conversation:updated', c);
  }
}

router.get('/', async (req, res) => {
  const r = await query<UserRow & { blocked_at: Date }>(
    `SELECT ${USER_COLS}, b.created_at AS blocked_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
    [req.userId],
  );
  res.json({ users: r.rows.map((u) => ({ ...publicUser(u), blockedAt: u.blocked_at })) });
});

router.post('/', async (req, res) => {
  const { userId } = parse(z.object({ userId: idParam }), req.body);
  if (userId === req.userId) throw fail(400, 'You can’t block yourself');
  const other = await one('SELECT id FROM users WHERE id = $1', [userId]);
  if (!other) throw fail(404, 'User not found');
  await query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, userId]);
  // Blocking ends the friendship both ways.
  await query(
    'DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
    [req.userId, userId],
  );
  emitToUsers([req.userId, userId], 'friends:changed', { by: req.userId });
  await refreshDirectChat(req.userId, userId);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.userId, id]);
  await refreshDirectChat(req.userId, id);
  res.json({ ok: true });
});

export default router;
