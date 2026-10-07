import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { blockBetween, getUser, publicUser, USER_COLS, type UserRow } from '../model.js';
import { pushToUsers } from '../push.js';
import { emitToUsers } from '../realtime/hub.js';
import { USERNAME } from './auth.js';

const router = Router();

type FriendRow = UserRow & { favorite: boolean; mutual: boolean; added_at: Date };

const serialize = (r: FriendRow) => ({ ...publicUser(r), favorite: r.favorite, mutual: r.mutual, addedAt: r.added_at });

router.get('/', async (req, res) => {
  const friends = await query<FriendRow>(
    `SELECT ${USER_COLS}, f.favorite, f.created_at AS added_at,
            EXISTS (SELECT 1 FROM friendships b WHERE b.user_id = u.id AND b.friend_id = $1) AS mutual
       FROM friendships f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = $1
      ORDER BY f.favorite DESC, lower(u.display_name)`,
    [req.userId],
  );
  const addedMe = await query<UserRow & { added_at: Date }>(
    `SELECT ${USER_COLS}, f.created_at AS added_at
       FROM friendships f JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = $1
        AND NOT EXISTS (SELECT 1 FROM friendships b WHERE b.user_id = $1 AND b.friend_id = f.user_id)
      ORDER BY f.created_at DESC LIMIT 50`,
    [req.userId],
  );
  res.json({
    friends: friends.rows.map(serialize),
    addedMe: addedMe.rows.map((r) => ({ ...publicUser(r), addedAt: r.added_at })),
  });
});

router.post('/', async (req, res) => {
  const body = parse(z.object({ username: USERNAME.optional(), userId: idParam.optional() }), req.body);
  const target = await one<{ id: number }>(
    'SELECT id FROM users WHERE id = $1 OR username = $2',
    [body.userId ?? null, body.username ?? null],
  );
  if (!target) throw fail(404, 'No one found with that username');
  if (target.id === req.userId) throw fail(400, 'That’s you!');
  const block = await blockBetween(req.userId, target.id);
  if (block === 'byMe') throw fail(400, 'You blocked this person — unblock them first');
  if (block === 'byThem') throw fail(404, 'No one found with that username');
  const added = await query('INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    req.userId,
    target.id,
  ]);
  const row = await one<FriendRow>(
    `SELECT ${USER_COLS}, f.favorite, f.created_at AS added_at,
            EXISTS (SELECT 1 FROM friendships b WHERE b.user_id = u.id AND b.friend_id = $1) AS mutual
       FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND f.friend_id = $2`,
    [req.userId, target.id],
  );
  // Let the other person know someone added them (shows under "Added you").
  emitToUsers([target.id], 'friends:changed', { by: req.userId });
  // Only a fresh add pops a notification — re-adding someone already added stays quiet.
  if (added.rowCount) {
    const me = await getUser(req.userId);
    emitToUsers([target.id], 'friends:added', { user: me, mutual: row!.mutual });
    if (me) {
      pushToUsers([target.id], {
        title: me.displayName,
        body: row!.mutual ? 'added you back — you’re friends now 💕' : 'added you as a friend',
        to: `/u/${me.username}`,
        tag: `friend:${me.id}`,
      }).catch((e) => console.error('[push] friend', e.message));
    }
  }
  res.status(201).json({ friend: serialize(row!) });
});

router.patch('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
  const r = await query('UPDATE friendships SET favorite = $3 WHERE user_id = $1 AND friend_id = $2', [
    req.userId,
    id,
    favorite,
  ]);
  if (!r.rowCount) throw fail(404, 'Not in your friends');
  res.json({ ok: true, favorite });
});

router.delete('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await query('DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2', [req.userId, id]);
  emitToUsers([id], 'friends:changed', { by: req.userId });
  res.json({ ok: true });
});

export default router;
