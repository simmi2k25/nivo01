import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { isForeground } from './realtime/hub.js';

/** Phone push notifications through Firebase Cloud Messaging (HTTP v1). Off when no service account is set. */

export type PushNote = { title: string; body: string; to: string; tag: string };

let cached: { token: string; expires: number } | null = null;

async function accessToken() {
  const fb = config.firebase!;
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const assertion = jwt.sign({ scope: 'https://www.googleapis.com/auth/firebase.messaging' }, fb.privateKey, {
    algorithm: 'RS256',
    issuer: fb.clientEmail,
    audience: 'https://oauth2.googleapis.com/token',
    expiresIn: 3600,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function sendOne(token: string, note: PushNote, bearer: string) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${config.firebase!.projectId}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: note.title, body: note.body },
        data: { to: note.to },
        android: {
          priority: 'high',
          notification: { channel_id: 'messages', sound: 'notify', tag: note.tag, icon: 'ic_stat_nivo', color: '#6f84de' },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.ok) return;
  const text = await r.text();
  // The app was uninstalled or the token rotated — forget it.
  if (r.status === 404 || text.includes('UNREGISTERED') || (r.status === 400 && text.includes('registration token'))) {
    await query('DELETE FROM push_tokens WHERE token = $1', [token]);
    return;
  }
  console.error('[push] send failed', r.status, text.slice(0, 200));
}

/** Notifies each user's phones, skipping anyone who has NivoTalk open on screen. */
export async function pushToUsers(userIds: number[], note: PushNote) {
  if (!config.firebase) return;
  const away = [...new Set(userIds)].filter((id) => !isForeground(id));
  if (!away.length) return;
  const r = await query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = ANY($1::bigint[])', [away]);
  if (!r.rowCount) return;
  const bearer = await accessToken();
  await Promise.all(r.rows.map((t) => sendOne(t.token, note, bearer).catch((e) => console.error('[push]', e.message))));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Push for a new chat message to everyone in the chat except the sender and people who muted it. */
export async function pushNewMessage(m: { conversation_id: number; sender_id: number | null; kind: string; body: string }) {
  if (!config.firebase || !m.sender_id || m.kind === 'system') return;
  const members = await query<{ user_id: number }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND NOT muted',
    [m.conversation_id, m.sender_id],
  );
  const ids = members.rows.map((r) => r.user_id).filter((id) => !isForeground(id));
  if (!ids.length) return;
  const info = await query<{ display_name: string; is_group: boolean; title: string | null }>(
    `SELECT u.display_name, c.is_group, c.title FROM users u, conversations c WHERE u.id = $1 AND c.id = $2`,
    [m.sender_id, m.conversation_id],
  );
  const name = info.rows[0]?.display_name ?? 'Someone';
  const group = info.rows[0]?.is_group;
  const body =
    m.kind === 'text'
      ? clip(m.body, 200)
      : m.kind === 'sticker'
        ? 'sent a sticker'
        : m.kind === 'photo'
          ? '📸 shared a photo strip'
          : 'opened a photobooth — join in!';
  await pushToUsers(ids, {
    title: group ? `${name} · ${info.rows[0]?.title ?? 'Group'}` : name,
    body,
    to: `/chats/${m.conversation_id}`,
    tag: `chat:${m.conversation_id}`,
  });
}
