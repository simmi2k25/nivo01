import type { Request } from 'express';
import { query } from './db.js';
import { fail } from './http.js';
import { hydrateMessages, type MessageRow } from './model.js';

/**
 * Deliver-then-delete: chats are kept on people's devices, not here. A message stays on the server only
 * until every member's recently active devices have confirmed receiving it.
 */

const ACTIVE_DAYS = 14; // devices quiet longer than this no longer hold messages back
const MAX_AGE_DAYS = 30; // nothing stays longer than this, delivered or not
const SYNC_BATCH = 500;

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The calling device's id (sent by the app as x-device-id), registered to the signed-in user. */
export async function deviceOf(req: Request) {
  const id = req.get('x-device-id');
  if (!id || !DEVICE_ID.test(id)) throw fail(400, 'Missing device id — please refresh the app');
  // A device that changes account starts over, so it never receives the previous account's chats.
  const prev = await query<{ user_id: number }>('SELECT user_id FROM devices WHERE id = $1', [id]);
  if (prev.rows[0] && prev.rows[0].user_id !== req.userId) await query('DELETE FROM devices WHERE id = $1', [id]);
  await query(
    `INSERT INTO devices (id, user_id) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET last_seen = now()`,
    [id, req.userId],
  );
  return id;
}

/** Everything this device hasn't received yet, across all its chats, oldest first. */
export async function pendingFor(userId: number, deviceId: string) {
  const r = await query<MessageRow>(
    `SELECT m.* FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
       LEFT JOIN device_cursors dc ON dc.device_id = $2 AND dc.conversation_id = m.conversation_id
      WHERE m.id > COALESCE(dc.delivered_id, 0)
      ORDER BY m.id
      LIMIT $3`,
    [userId, deviceId, SYNC_BATCH + 1],
  );
  const more = r.rows.length > SYNC_BATCH;
  return { messages: await hydrateMessages(r.rows.slice(0, SYNC_BATCH)), more };
}

/** Records what a device has stored, then deletes whatever every member's devices now have. */
export async function acknowledge(userId: number, deviceId: string, upTo: Record<string, number>) {
  const convIds: number[] = [];
  for (const [conv, id] of Object.entries(upTo)) {
    const conversationId = Number(conv);
    if (!Number.isInteger(conversationId) || !Number.isInteger(id) || id <= 0) continue;
    const r = await query(
      `INSERT INTO device_cursors (device_id, conversation_id, delivered_id)
       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $2 AND user_id = $4)
       ON CONFLICT (device_id, conversation_id) DO UPDATE SET delivered_id = GREATEST(device_cursors.delivered_id, EXCLUDED.delivered_id)`,
      [deviceId, conversationId, id, userId],
    );
    if (r.rowCount) convIds.push(conversationId);
  }
  for (const id of convIds) await purgeConversation(id);
}

/**
 * Deletes the messages in a chat that all members have received. A member with no active device holds
 * everything back (they'd otherwise never see it) until the 30-day limit.
 */
export async function purgeConversation(conversationId: number) {
  const r = await query<{ upto: number }>(
    `WITH dev AS (
       SELECT cm.user_id, d.id AS device_id
         FROM conversation_members cm
         LEFT JOIN devices d ON d.user_id = cm.user_id AND d.last_seen > now() - make_interval(days => $2)
        WHERE cm.conversation_id = $1
     )
     SELECT COALESCE(MIN(COALESCE(dc.delivered_id, 0)), 0)::bigint AS upto
       FROM dev LEFT JOIN device_cursors dc ON dc.device_id = dev.device_id AND dc.conversation_id = $1`,
    [conversationId, ACTIVE_DAYS],
  );
  const upto = Number(r.rows[0]?.upto ?? 0);
  if (upto > 0) await query('DELETE FROM messages WHERE conversation_id = $1 AND id <= $2', [conversationId, upto]);
}

/** Hourly clean-up: messages past 30 days and devices nobody has used for two months. */
export async function purgeExpired() {
  const m = await query('DELETE FROM messages WHERE created_at < now() - make_interval(days => $1)', [MAX_AGE_DAYS]);
  await query(`DELETE FROM devices WHERE last_seen < now() - interval '60 days'`);
  if (m.rowCount) console.log(`[delivery] removed ${m.rowCount} expired messages`);
}
