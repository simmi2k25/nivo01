import express, { Router } from 'express';
import { z } from 'zod';
import { PRICES, pushBalance, spend } from '../coins.js';
import { one, query, tx } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import {
  assertNotBlocked,
  blockBetween,
  conversationsFor,
  hydrateMessages,
  getUser,
  isMember,
  memberIds,
  postMessage,
  REACTIONS,
  STICKER_ID,
  type MessageRow,
} from '../model.js';
import { sniffImage } from '../images.js';
import { pushToUsers } from '../push.js';
import { emitToUsers } from '../realtime/hub.js';

const router = Router();
const MAX_GROUP = 30;

async function requireMember(conversationId: number, userId: number) {
  if (!(await isMember(conversationId, userId))) throw fail(404, 'Chat not found');
}

async function summaryFor(userId: number, id: number) {
  const [c] = await conversationsFor(userId, id);
  return c;
}

/** Pushes a fresh per-user summary of the chat to each listed member. */
async function pushConversation(event: 'conversation:new' | 'conversation:updated', id: number, userIds: number[]) {
  await Promise.all(
    userIds.map(async (uid) => {
      const c = await summaryFor(uid, id);
      if (c) emitToUsers([uid], event, c);
    }),
  );
}

const nameOf = async (id: number) => (await getUser(id))?.displayName ?? 'Someone';

/** Drops anyone who blocked, or was blocked by, `me`. */
async function notBlocked(me: number, ids: number[]) {
  if (!ids.length) return ids;
  const r = await query<{ id: number }>(
    `SELECT b.blocked_id AS id FROM blocks b WHERE b.blocker_id = $1 AND b.blocked_id = ANY($2::bigint[])
     UNION SELECT b.blocker_id FROM blocks b WHERE b.blocked_id = $1 AND b.blocker_id = ANY($2::bigint[])`,
    [me, ids],
  );
  const blocked = new Set(r.rows.map((x) => x.id));
  return ids.filter((x) => !blocked.has(x));
}

router.get('/', async (req, res) => {
  res.json({ conversations: await conversationsFor(req.userId) });
});

router.post('/direct', async (req, res) => {
  const { userId } = parse(z.object({ userId: idParam }), req.body);
  if (userId === req.userId) throw fail(400, 'You can’t chat with yourself here');
  const other = await one('SELECT id FROM users WHERE id = $1', [userId]);
  if (!other) throw fail(404, 'User not found');

  const key = [req.userId, userId].sort((a, b) => a - b).join(':');
  if (await blockBetween(req.userId, userId)) {
    // An existing chat can still be opened to read; a new one can't be started.
    const existing = await one<{ id: number }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
    if (!existing) throw fail(403, 'You can’t message this person');
    res.json({ conversation: await summaryFor(req.userId, existing.id) });
    return;
  }
  const { id, created } = await tx(async (c) => {
    const ins = await c.query<{ id: number }>(
      `INSERT INTO conversations (is_group, direct_key, created_by) VALUES (false, $1, $2)
       ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
      [key, req.userId],
    );
    if (ins.rowCount) {
      const cid = ins.rows[0].id;
      await c.query(
        'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
        [cid, req.userId, userId],
      );
      return { id: cid, created: true };
    }
    const existing = await c.query<{ id: number }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
    const cid = existing.rows[0].id;
    // Re-add anyone who might be missing (direct chats can't be left, but stay safe).
    await c.query(
      `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [cid, req.userId, userId],
    );
    return { id: cid, created: false };
  });
  if (created) await pushConversation('conversation:new', id, [userId]);
  res.status(created ? 201 : 200).json({ conversation: await summaryFor(req.userId, id) });
});

router.post('/group', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().max(40).optional(),
      memberIds: z.array(idParam).min(1, 'Pick at least one friend').max(MAX_GROUP - 1),
    }),
    req.body,
  );
  const ids = [...new Set(body.memberIds.filter((x) => x !== req.userId))];
  const found = await query<{ id: number }>('SELECT id FROM users WHERE id = ANY($1::bigint[])', [ids]);
  if (found.rowCount !== ids.length) throw fail(400, 'Some people couldn’t be found');

  // Starting a group costs coins; the people picked get an invitation they accept with a coin.
  const id = await tx(async (c) => {
    const conv = await c.query<{ id: number }>(
      'INSERT INTO conversations (is_group, title, created_by) VALUES (true, $1, $2) RETURNING id',
      [body.title || null, req.userId],
    );
    const cid = conv.rows[0].id;
    await spend(c, req.userId, PRICES.groupCreate, 'group_create', { conversationId: cid });
    await c.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)', [cid, req.userId]);
    return cid;
  });
  await pushBalance(req.userId);
  await postMessage({
    conversationId: id,
    senderId: null,
    kind: 'system',
    body: `${await nameOf(req.userId)} created the group`,
    meta: { event: 'created', by: req.userId },
  });
  await invite(id, req.userId, await notBlocked(req.userId, ids));
  res.status(201).json({ conversation: await summaryFor(req.userId, id) });
});

// ---------- group invitations (creating a group costs coins; invited people join with a coin) ----------

/** Invites people to a group; they appear in the group once they accept. */
async function invite(conversationId: number, by: number, userIds: number[]) {
  if (!userIds.length) return;
  await query(
    `INSERT INTO group_invites (conversation_id, user_id, invited_by) SELECT $1, unnest($2::bigint[]), $3
     ON CONFLICT DO NOTHING`,
    [conversationId, userIds, by],
  );
  const [inviter, conv] = await Promise.all([
    getUser(by),
    one<{ title: string | null }>('SELECT title FROM conversations WHERE id = $1', [conversationId]),
  ]);
  const group = conv?.title || 'a group';
  emitToUsers(userIds, 'invites:changed', {});
  for (const uid of userIds) {
    notifyInvite(uid, inviter?.displayName ?? 'Someone', group);
  }
}

function notifyInvite(userId: number, inviter: string, group: string) {
  pushToUsers([userId], {
    title: `${inviter} invited you to ${group}`,
    body: `Join for ${PRICES.groupJoin} coin`,
    to: '/chats',
    tag: 'invites',
  }).catch(() => {});
}

router.get('/invites', async (req, res) => {
  const r = await query<{ conversation_id: number; title: string | null; invited_by: number | null; created_at: Date; members: number }>(
    `SELECT gi.conversation_id, c.title, gi.invited_by, gi.created_at,
            (SELECT count(*)::int FROM conversation_members cm WHERE cm.conversation_id = gi.conversation_id) AS members
       FROM group_invites gi JOIN conversations c ON c.id = gi.conversation_id
      WHERE gi.user_id = $1 ORDER BY gi.created_at DESC`,
    [req.userId],
  );
  const invites = await Promise.all(
    r.rows.map(async (i) => ({
      conversationId: i.conversation_id,
      title: i.title,
      memberCount: i.members,
      invitedBy: i.invited_by ? await getUser(i.invited_by) : null,
      createdAt: i.created_at,
    })),
  );
  res.json({ invites, price: PRICES.groupJoin });
});

router.post('/:id/join', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const coins = await tx(async (c) => {
    const inv = await c.query('DELETE FROM group_invites WHERE conversation_id = $1 AND user_id = $2 RETURNING 1', [id, req.userId]);
    if (!inv.rowCount) throw fail(404, 'This invitation is no longer available');
    const n = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1', [id]);
    if (n.rows[0].n >= MAX_GROUP) throw fail(400, `Groups hold up to ${MAX_GROUP} people`);
    const left = await spend(c, req.userId, PRICES.groupJoin, 'group_join', { conversationId: id });
    await c.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.userId]);
    return left;
  });
  await pushBalance(req.userId);
  emitToUsers([req.userId], 'invites:changed', {});
  const others = (await memberIds(id)).filter((u) => u !== req.userId);
  await postMessage({
    conversationId: id,
    senderId: null,
    kind: 'system',
    body: `${await nameOf(req.userId)} joined the group`,
    meta: { event: 'joined', userId: req.userId },
  });
  await pushConversation('conversation:updated', id, others);
  res.json({ coins, conversation: await summaryFor(req.userId, id) });
});

router.post('/:id/decline', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await query('DELETE FROM group_invites WHERE conversation_id = $1 AND user_id = $2', [id, req.userId]);
  emitToUsers([req.userId], 'invites:changed', {});
  res.json({ ok: true });
});

// ---------- chat wallpaper (costs coins; everyone in the chat sees it) ----------

const WALLPAPER_BYTES = 3 * 1024 * 1024;

router.get('/wallpapers/:wid', async (req, res) => {
  const wid = parse(idParam, req.params.wid);
  const w = await one<{ mime: string; data: Buffer }>(
    `SELECT w.mime, w.data FROM chat_wallpapers w
       JOIN conversation_members cm ON cm.conversation_id = w.conversation_id AND cm.user_id = $2
      WHERE w.id = $1`,
    [wid, req.userId],
  );
  if (!w) throw fail(404, 'Wallpaper not found');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(w.mime).send(w.data);
});

router.put('/:id/wallpaper', express.raw({ type: () => true, limit: WALLPAPER_BYTES }), async (req, res) => {
  const id = parse(idParam, req.params.id);
  await requireMember(id, req.userId);
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || !buf.length) throw fail(400, 'No image received');
  const info = sniffImage(buf);
  if (!info) throw fail(415, 'Please use a JPEG, PNG or WebP image');
  if (info.width > 4000 || info.height > 4000) throw fail(413, 'That image is too large');
  const coins = await tx(async (c) => {
    const left = await spend(c, req.userId, PRICES.wallpaper, 'wallpaper', { conversationId: id });
    const old = await c.query<{ wallpaper_id: number | null }>('SELECT wallpaper_id FROM conversations WHERE id = $1 FOR UPDATE', [id]);
    const w = await c.query<{ id: number }>(
      'INSERT INTO chat_wallpapers (conversation_id, set_by, mime, data) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, req.userId, info.mime, buf],
    );
    await c.query('UPDATE conversations SET wallpaper_id = $2 WHERE id = $1', [id, w.rows[0].id]);
    if (old.rows[0]?.wallpaper_id) await c.query('DELETE FROM chat_wallpapers WHERE id = $1', [old.rows[0].wallpaper_id]);
    return left;
  });
  await pushBalance(req.userId);
  await postMessage({
    conversationId: id,
    senderId: null,
    kind: 'system',
    body: `${await nameOf(req.userId)} set a new chat wallpaper 🖼️`,
    meta: { event: 'wallpaper', by: req.userId },
  });
  await pushConversation('conversation:updated', id, await memberIds(id));
  res.json({ coins, conversation: await summaryFor(req.userId, id) });
});

router.delete('/:id/wallpaper', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await requireMember(id, req.userId);
  const old = await one<{ wallpaper_id: number | null }>('SELECT wallpaper_id FROM conversations WHERE id = $1', [id]);
  if (old?.wallpaper_id) {
    await query('UPDATE conversations SET wallpaper_id = NULL WHERE id = $1', [id]);
    await query('DELETE FROM chat_wallpapers WHERE id = $1', [old.wallpaper_id]);
    await postMessage({
      conversationId: id,
      senderId: null,
      kind: 'system',
      body: `${await nameOf(req.userId)} removed the chat wallpaper`,
      meta: { event: 'wallpaper', by: req.userId },
    });
    await pushConversation('conversation:updated', id, await memberIds(id));
  }
  res.json({ conversation: await summaryFor(req.userId, id) });
});

router.get('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const c = await summaryFor(req.userId, id);
  if (!c) throw fail(404, 'Chat not found');
  res.json({ conversation: c });
});

router.patch('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const body = parse(
    z.object({ title: z.string().trim().min(1).max(40).optional(), muted: z.boolean().optional() }),
    req.body,
  );
  await requireMember(id, req.userId);
  if (body.muted !== undefined) {
    await query('UPDATE conversation_members SET muted = $3 WHERE conversation_id = $1 AND user_id = $2', [
      id,
      req.userId,
      body.muted,
    ]);
  }
  if (body.title !== undefined) {
    const conv = await one<{ is_group: boolean }>('SELECT is_group FROM conversations WHERE id = $1', [id]);
    if (!conv?.is_group) throw fail(400, 'Only groups can be renamed');
    await query('UPDATE conversations SET title = $2 WHERE id = $1', [id, body.title]);
    await postMessage({
      conversationId: id,
      senderId: null,
      kind: 'system',
      body: `${await nameOf(req.userId)} renamed the group to “${body.title}”`,
      meta: { event: 'renamed', by: req.userId },
    });
    await pushConversation('conversation:updated', id, await memberIds(id));
  }
  res.json({ conversation: await summaryFor(req.userId, id) });
});

router.post('/:id/members', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { userIds } = parse(z.object({ userIds: z.array(idParam).min(1).max(MAX_GROUP) }), req.body);
  await requireMember(id, req.userId);
  const conv = await one<{ is_group: boolean }>('SELECT is_group FROM conversations WHERE id = $1', [id]);
  if (!conv?.is_group) throw fail(400, 'You can only invite people to groups');

  const current = await memberIds(id);
  const fresh = await notBlocked(req.userId, [...new Set(userIds)].filter((u) => !current.includes(u)));
  if (!fresh.length) throw fail(400, 'They’re already here');
  if (current.length + fresh.length > MAX_GROUP) throw fail(400, `Groups hold up to ${MAX_GROUP} people`);
  const found = await query<{ id: number; display_name: string }>(
    'SELECT id, display_name FROM users WHERE id = ANY($1::bigint[])',
    [fresh],
  );
  if (found.rowCount !== fresh.length) throw fail(400, 'Some people couldn’t be found');

  await invite(id, req.userId, fresh);
  await postMessage({
    conversationId: id,
    senderId: null,
    kind: 'system',
    body: `${await nameOf(req.userId)} invited ${found.rows.map((r) => r.display_name).join(', ')}`,
    meta: { event: 'invited', by: req.userId, userIds: fresh },
  });
  res.json({ conversation: await summaryFor(req.userId, id) });
});

router.post('/:id/leave', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await requireMember(id, req.userId);
  const conv = await one<{ is_group: boolean }>('SELECT is_group FROM conversations WHERE id = $1', [id]);
  if (!conv?.is_group) throw fail(400, 'Direct chats can’t be left');
  const name = await nameOf(req.userId);
  await query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [id, req.userId]);
  const remaining = await memberIds(id);
  if (!remaining.length) {
    await query('DELETE FROM conversations WHERE id = $1', [id]);
  } else {
    await postMessage({
      conversationId: id,
      senderId: null,
      kind: 'system',
      body: `${name} left the group`,
      meta: { event: 'left', userId: req.userId },
    });
    await pushConversation('conversation:updated', id, remaining);
  }
  emitToUsers([req.userId], 'conversation:removed', { id });
  res.json({ ok: true });
});

router.get('/:id/messages', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { before, limit } = parse(
    z.object({ before: idParam.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }),
    req.query,
  );
  await requireMember(id, req.userId);
  const r = await query<MessageRow>(
    `SELECT * FROM messages WHERE conversation_id = $1 AND ($2::bigint IS NULL OR id < $2)
     ORDER BY id DESC LIMIT $3`,
    [id, before ?? null, limit + 1],
  );
  const hasMore = r.rows.length > limit;
  const rows = r.rows.slice(0, limit).reverse();
  res.json({ messages: await hydrateMessages(rows), hasMore });
});

const sendSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    body: z.string().trim().min(1, 'Message is empty').max(4000, 'Messages can be up to 4,000 characters'),
    clientId: z.string().max(64).optional(),
    replyToId: idParam.optional(),
  }),
  z.object({
    kind: z.literal('sticker'),
    meta: z.object({ stickerId: z.string().regex(STICKER_ID, 'Unknown sticker') }),
    clientId: z.string().max(64).optional(),
    replyToId: idParam.optional(),
  }),
  z.object({
    kind: z.literal('photo'),
    body: z.string().trim().max(300).default(''),
    meta: z.object({ photoId: idParam }),
    clientId: z.string().max(64).optional(),
    replyToId: idParam.optional(),
  }),
]);

router.post('/:id/messages', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const msg = parse(sendSchema, req.body);
  await requireMember(id, req.userId);

  if (msg.kind === 'photo') {
    const owned = await one('SELECT 1 FROM photos WHERE id = $1 AND owner_id = $2', [msg.meta.photoId, req.userId]);
    if (!owned) throw fail(404, 'Photo not found');
  }
  const out = await postMessage({
    conversationId: id,
    senderId: req.userId,
    kind: msg.kind,
    body: msg.kind === 'sticker' ? '' : msg.body,
    meta: msg.kind === 'text' ? {} : msg.meta,
    clientId: msg.clientId,
    replyToId: msg.replyToId,
  });
  res.status(201).json({ message: out });
});

/**
 * Edits, deletions and reactions are sent as 'op' messages: most originals have already been delivered and
 * removed from the server, so each device applies the change to its own copy (and checks the op's sender
 * owns the message for edits and deletes). If the original is still here, it's updated too.
 */
async function sendOp(req: { params: Record<string, string>; userId: number }, op: Record<string, unknown>, own: boolean) {
  const id = parse(idParam, req.params.id);
  const targetId = parse(idParam, req.params.mid);
  await requireMember(id, req.userId);
  const m = await one<MessageRow>('SELECT * FROM messages WHERE id = $1 AND conversation_id = $2', [targetId, id]);
  if (m && (m.deleted_at || m.kind === 'system' || m.kind === 'op')) throw fail(404, 'Message not found');
  if (m && own && m.sender_id !== req.userId) throw fail(403, 'You can only change your own messages');
  if (op.op === 'edit' && m && m.kind !== 'text') throw fail(400, 'Only text messages can be edited');
  const message = await postMessage({ conversationId: id, senderId: req.userId, kind: 'op', meta: { ...op, targetId } });
  return { m, message };
}

router.patch('/:id/messages/:mid', async (req, res) => {
  const { body } = parse(
    z.object({ body: z.string().trim().min(1, 'Message is empty').max(4000, 'Messages can be up to 4,000 characters') }),
    req.body,
  );
  const { m, message } = await sendOp(req, { op: 'edit', body }, true);
  if (m) await query('UPDATE messages SET body = $2, edited_at = now() WHERE id = $1', [m.id, body]);
  res.json({ op: message });
});

// Deletes for everyone: devices wipe their copy and show a "message deleted" placeholder.
router.delete('/:id/messages/:mid', async (req, res) => {
  const { m, message } = await sendOp(req, { op: 'delete' }, true);
  if (m) {
    await query(`UPDATE messages SET deleted_at = now(), body = '', meta = '{}'::jsonb WHERE id = $1`, [m.id]);
    await query('DELETE FROM message_reactions WHERE message_id = $1', [m.id]);
  }
  res.json({ op: message });
});

router.put('/:id/messages/:mid/reaction', async (req, res) => {
  const { emoji } = parse(z.object({ emoji: z.enum(REACTIONS).nullable() }), req.body);
  const { m, message } = await sendOp(req, { op: 'react', emoji }, false);
  if (m && emoji) {
    await query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
      [m.id, req.userId, emoji],
    );
  } else if (m) {
    await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [m.id, req.userId]);
  }
  res.json({ op: message });
});

router.post('/:id/read', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await requireMember(id, req.userId);
  const r = await one<{ last_read_at: Date }>(
    `UPDATE conversation_members SET last_read_at = GREATEST(last_read_at, now())
      WHERE conversation_id = $1 AND user_id = $2 RETURNING last_read_at`,
    [id, req.userId],
  );
  emitToUsers(await memberIds(id), 'conversation:read', {
    conversationId: id,
    userId: req.userId,
    lastReadAt: r!.last_read_at,
  });
  res.json({ ok: true, lastReadAt: r!.last_read_at });
});

export default router;
