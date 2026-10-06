import type pg from 'pg';
import { pool, query } from './db.js';
import { emitToUsers, isOnline } from './realtime/hub.js';

export const BUDDIES = ['berri', 'chatty', 'dino', 'pepo', 'pomi'] as const;
export const STICKER_ID = /^(berri|chatty|dino|pepo|pomi)-\d{2,3}$/;

export const USER_COLS = `u.id, u.username, u.display_name, u.status_message, u.avatar, u.theme_color,
  u.last_seen_at, u.avatar_image_id, u.cover_image_id, u.profile_song`;

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

// ---------- chats ----------

export type MessageRow = {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  kind: string;
  body: string;
  meta: Record<string, unknown>;
  created_at: Date;
};

export const serializeMessage = (m: MessageRow, clientId?: string) => ({
  id: m.id,
  conversationId: m.conversation_id,
  senderId: m.sender_id,
  kind: m.kind,
  body: m.body,
  meta: m.meta ?? {},
  createdAt: m.created_at,
  ...(clientId ? { clientId } : {}),
});

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
  kind: 'text' | 'sticker' | 'photo' | 'booth_invite' | 'system';
  body?: string;
  meta?: Record<string, unknown>;
  clientId?: string;
}) {
  const { conversationId, senderId, kind, body = '', meta = {}, clientId } = opts;
  const r = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, sender_id, kind, body, meta) VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, senderId, kind, body, JSON.stringify(meta)],
  );
  const msg = r.rows[0];
  await query('UPDATE conversations SET updated_at = $2 WHERE id = $1', [conversationId, msg.created_at]);
  if (senderId) {
    await query(
      'UPDATE conversation_members SET last_read_at = $3 WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, senderId, msg.created_at],
    );
  }
  const out = serializeMessage(msg, clientId);
  emitToUsers(await memberIds(conversationId), 'message:new', out);
  return out;
}

/** Builds full conversation summaries for a user in three queries, regardless of chat count. */
export async function conversationsFor(userId: number, onlyId?: number) {
  const convs = await query(
    `SELECT c.id, c.is_group, c.title, c.created_by, c.created_at, c.updated_at, m.last_read_at, m.muted
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
                AND x.sender_id IS DISTINCT FROM $2) AS unread
       FROM messages msg
       JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = $2
      WHERE msg.conversation_id = ANY($1::bigint[])
      ORDER BY msg.conversation_id, msg.id DESC`,
    [ids, userId],
  );

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
    };
  });
}
