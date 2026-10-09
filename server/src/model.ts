import type pg from 'pg';
import { pool, query } from './db.js';
import { fail } from './http.js';
import { pushNewMessage } from './push.js';
import { emitToUsers, isOnline } from './realtime/hub.js';

export const BUDDIES = ['berri', 'chatty', 'dino', 'pepo', 'pomi'] as const;
export const STICKER_ID = /^(berri|chatty|dino|pepo|pomi)-\d{2,3}$/;

export const USER_COLS = `u.id, u.username, u.display_name, u.status_message, u.avatar, u.theme_color,
  u.last_seen_at, u.avatar_image_id, u.cover_image_id, u.profile_song, u.is_admin`;

export type UserRow = {
  id: number;
  username: string;
  display_name: string;
  status_message: string;
  avatar: string;
  theme_color: string;
  last_seen_at: Date | null;
  avatar_image_id: number | null;
  cover_image_id: number | null;
  profile_song: unknown;
  is_admin: boolean;
};

export const imageUrl = (id: number | null) => (id ? `/api/users/images/${id}` : null);

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    bio: u.status_message,
    avatar: u.avatar,
    themeColor: u.theme_color,
    avatarUrl: imageUrl(u.avatar_image_id),
    coverUrl: imageUrl(u.cover_image_id),
    song: u.profile_song ?? null,
    lastSeenAt: u.last_seen_at,
    online: isOnline(u.id),
    /** The official NivoTalk account: posts announcements, shown with a badge. */
    isAdmin: !!u.is_admin,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

export async function getUser(id: number) {
  const r = await query<UserRow>(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]);
  return r.rows[0] ? publicUser(r.rows[0]) : null;
}

/** Everyone who should hear about changes to this user: people who added them, and chat partners. */
export async function audienceOf(userId: number): Promise<number[]> {
  const r = await query<{ id: number }>(
    `SELECT user_id AS id FROM friendships WHERE friend_id = $1
     UNION
     SELECT m2.user_id FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
      WHERE m1.user_id = $1 AND m2.user_id <> $1`,
    [userId],
  );
  return r.rows.map((x) => x.id);
}

export async function broadcastUserUpdate(userId: number) {
  const user = await getUser(userId);
  if (!user) return;
  emitToUsers([userId, ...(await audienceOf(userId))], 'user:updated', user);
}

// ---------- blocking ----------

/** From `me`'s side: 'byMe' if I blocked them, 'byThem' if they blocked me, null otherwise. */
export async function blockBetween(me: number, other: number): Promise<'byMe' | 'byThem' | null> {
  const r = await query<{ blocker_id: number }>(
    `SELECT blocker_id FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [me, other],
  );
  if (!r.rowCount) return null;
  return r.rows.some((b) => b.blocker_id === me) ? 'byMe' : 'byThem';
}

/** Throws when the sender and the other person in a direct chat have blocked each other. Groups are unaffected. */
export async function assertNotBlocked(conversationId: number, senderId: number) {
  const r = await query(
    `SELECT 1 FROM conversations c
       JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> $2
       JOIN blocks b ON (b.blocker_id = $2 AND b.blocked_id = o.user_id) OR (b.blocker_id = o.user_id AND b.blocked_id = $2)
      WHERE c.id = $1 AND NOT c.is_group
      LIMIT 1`,
    [conversationId, senderId],
  );
  if (r.rowCount) throw fail(403, 'You can’t message this person');
}

// ---------- chats ----------

export type MessageRow = {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  kind: string;
  body: string;
  meta: Record<string, unknown>;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reply_to_id: number | null;
};

/** Emoji people can react with. */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;

export const serializeMessage = (m: MessageRow, clientId?: string) => ({
  id: m.id,
  conversationId: m.conversation_id,
  senderId: m.sender_id,
  kind: m.kind,
  body: m.deleted_at ? '' : m.body,
  meta: m.deleted_at ? {} : (m.meta ?? {}),
  createdAt: m.created_at,
  editedAt: m.edited_at ?? null,
  deletedAt: m.deleted_at ?? null,
  replyToId: m.reply_to_id ?? null,
  ...(clientId ? { clientId } : {}),
});

type ReplyPreview = { id: number; senderId: number | null; kind: string; body: string; deleted: boolean };
export type FullMessage = ReturnType<typeof serializeMessage> & {
  replyTo: ReplyPreview | null;
  reactions: Record<string, string>;
};

/** Serializes messages with the message each one replies to and everyone's reactions (two queries total). */
export async function hydrateMessages(rows: MessageRow[], clientIds: Record<number, string> = {}): Promise<FullMessage[]> {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map((m) => m.reply_to_id).filter((x): x is number => !!x))];
  const replies = replyIds.length
    ? await query<MessageRow>('SELECT * FROM messages WHERE id = ANY($1::bigint[])', [replyIds])
    : { rows: [] as MessageRow[] };
  const replyById = new Map(replies.rows.map((r) => [r.id, r]));
  const reacts = await query<{ message_id: number; user_id: number; emoji: string }>(
    'SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id = ANY($1::bigint[]) ORDER BY created_at',
    [rows.map((m) => m.id)],
  );
  const reactsBy = new Map<number, Record<string, string>>();
  for (const r of reacts.rows) reactsBy.set(r.message_id, { ...(reactsBy.get(r.message_id) ?? {}), [r.user_id]: r.emoji });

  return rows.map((m) => {
    const r = m.reply_to_id ? replyById.get(m.reply_to_id) : undefined;
    return {
      ...serializeMessage(m, clientIds[m.id]),
      replyTo: r
        ? { id: r.id, senderId: r.sender_id, kind: r.kind, body: r.deleted_at ? '' : r.body.slice(0, 200), deleted: !!r.deleted_at }
        : null,
      reactions: reactsBy.get(m.id) ?? {},
    };
  });
}

export async function isMember(conversationId: number, userId: number) {
  const r = await query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
    conversationId,
    userId,
  ]);
  return r.rowCount! > 0;
}

export async function memberIds(conversationId: number, db: pg.Pool | pg.PoolClient = pool) {
  const r = await db.query<{ user_id: number }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
    [conversationId],
  );
  return r.rows.map((x) => x.user_id);
}

/** Stores a message, bumps the chat, marks it read for the sender and pushes it to every member. */
export async function postMessage(opts: {
  conversationId: number;
  senderId: number | null;
  kind: 'text' | 'sticker' | 'photo' | 'booth_invite' | 'system' | 'op';
  body?: string;
  meta?: Record<string, unknown>;
  clientId?: string;
  replyToId?: number;
}) {
  const { conversationId, senderId, kind, body = '', meta = {}, clientId } = opts;
  if (senderId) await assertNotBlocked(conversationId, senderId);
  let replyToId: number | null = null;
  if (opts.replyToId) {
    // The original is usually already delivered and deleted here; if it's still around, it must be in this chat.
    const target = await query<{ conversation_id: number }>('SELECT conversation_id FROM messages WHERE id = $1', [opts.replyToId]);
    if (target.rows[0] && target.rows[0].conversation_id !== conversationId) throw fail(400, 'That message isn’t in this chat');
    replyToId = opts.replyToId;
  }
  const r = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, sender_id, kind, body, meta, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [conversationId, senderId, kind, body, JSON.stringify(meta), replyToId],
  );
  const msg = r.rows[0];
  const [out] = await hydrateMessages([msg], clientId ? { [msg.id]: clientId } : {});
  // An op (edit, delete, reaction) changes an earlier message: no reordering, unread bump or push.
  if (kind === 'op') {
    emitToUsers(await memberIds(conversationId), 'message:new', out);
    return out;
  }
  await query('UPDATE conversations SET updated_at = $2 WHERE id = $1', [conversationId, msg.created_at]);
  if (senderId) {
    await query(
      'UPDATE conversation_members SET last_read_at = $3 WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, senderId, msg.created_at],
    );
  }
  emitToUsers(await memberIds(conversationId), 'message:new', out);
  pushNewMessage(msg).catch((e) => console.error('[push] message', e.message));
  return out;
}

/** Builds full conversation summaries for a user in three queries, regardless of chat count. */
export async function conversationsFor(userId: number, onlyId?: number) {
  const convs = await query(
    `SELECT c.id, c.is_group, c.title, c.created_by, c.created_at, c.updated_at, c.wallpaper_id, m.last_read_at, m.muted
       FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1
      WHERE ($2::bigint IS NULL OR c.id = $2)
      ORDER BY c.updated_at DESC LIMIT 200`,
    [userId, onlyId ?? null],
  );
  if (!convs.rowCount) return [];
  const ids = convs.rows.map((c) => c.id);

  const members = await query<UserRow & { conversation_id: number; member_last_read_at: Date }>(
    `SELECT cm.conversation_id, cm.last_read_at AS member_last_read_at, ${USER_COLS}
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ANY($1::bigint[])
      ORDER BY cm.joined_at`,
    [ids],
  );
  const last = await query<MessageRow & { unread: number }>(
    `SELECT DISTINCT ON (msg.conversation_id) msg.*,
            (SELECT count(*)::int FROM messages x
              WHERE x.conversation_id = msg.conversation_id
                AND x.created_at > cm.last_read_at
                AND x.kind <> 'op'
                AND x.sender_id IS DISTINCT FROM $2) AS unread
       FROM messages msg
       JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = $2
      WHERE msg.conversation_id = ANY($1::bigint[]) AND msg.kind <> 'op'
      ORDER BY msg.conversation_id, msg.id DESC`,
    [ids, userId],
  );

  const blocks = await query<{ blocker_id: number; blocked_id: number }>(
    'SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = $1 OR blocked_id = $1',
    [userId],
  );
  const blockedByMe = new Set(blocks.rows.filter((b) => b.blocker_id === userId).map((b) => b.blocked_id));
  const blockedMe = new Set(blocks.rows.filter((b) => b.blocked_id === userId).map((b) => b.blocker_id));

  const byConv = new Map<number, { user: PublicUser; lastReadAt: Date }[]>();
  for (const m of members.rows) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push({ user: publicUser(m), lastReadAt: m.member_last_read_at });
    byConv.set(m.conversation_id, list);
  }
  const lastBy = new Map(last.rows.map((m) => [m.conversation_id, m]));

  return convs.rows.map((c) => {
    const lm = lastBy.get(c.id);
    const ms = byConv.get(c.id) ?? [];
    const other = c.is_group ? undefined : ms.find((m) => m.user.id !== userId)?.user.id;
    const block = other === undefined ? null : blockedByMe.has(other) ? 'byMe' : blockedMe.has(other) ? 'byThem' : null;
    return {
      id: c.id,
      isGroup: c.is_group,
      title: c.title,
      createdBy: c.created_by,
      updatedAt: c.updated_at,
      muted: c.muted,
      lastReadAt: c.last_read_at,
      unread: lm?.unread ?? 0,
      lastMessage: lm ? serializeMessage(lm) : null,
      members: ms.map((m) => m.user),
      readStates: Object.fromEntries(ms.map((m) => [m.user.id, m.lastReadAt])),
      block,
      wallpaperUrl: c.wallpaper_id ? `/api/conversations/wallpapers/${c.wallpaper_id}` : null,
    };
  });
}
