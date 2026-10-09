import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { audienceOf, publicUser, STICKER_ID, USER_COLS, type UserRow } from '../model.js';
import { emitToUsers } from '../realtime/hub.js';

/** Text statuses ("stories"): styled messages friends see for 24 hours. */
const router = Router();

const MAX_ACTIVE = 30;
// Kept in step with the presets in client/src/lib/statusStyles.ts.
export const STATUS_BGS = ['periwinkle', 'blush', 'mint', 'sunset', 'lilac', 'ocean', 'peach', 'night', 'berry', 'sky'] as const;
export const STATUS_FONTS = ['display', 'script', 'hand', 'body'] as const;

const styleSchema = z
  .object({
    bg: z.enum(STATUS_BGS).default('periwinkle'),
    font: z.enum(STATUS_FONTS).default('display'),
    size: z.enum(['s', 'm', 'l']).default('m'),
  })
  .default({ bg: 'periwinkle', font: 'display', size: 'm' });

/** Pen strokes and stickers on top. Positions are fractions of the screen (0–1) so they fit any phone. */
const unit = z.number().min(0).max(1);
const artSchema = z
  .object({
    strokes: z
      .array(
        z.object({
          c: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          w: z.number().min(1).max(40),
          // flat [x, y, x, y, …]
          p: z.array(unit).min(2).max(2000),
        }),
      )
      .max(150)
      .default([]),
    stickers: z
      .array(z.object({ id: z.string().regex(STICKER_ID), x: unit, y: unit, s: z.number().min(0.08).max(0.9), r: z.number().min(-180).max(180).default(0) }))
      .max(20)
      .default([]),
  })
  .default({ strokes: [], stickers: [] })
  .refine((a) => a.strokes.reduce((n, s) => n + s.p.length, 0) <= 12_000, 'That drawing is too detailed — try fewer strokes');

type StatusRow = { id: number; user_id: number; text: string; style: unknown; art: unknown; created_at: Date; expires_at: Date; seen: boolean; views: number };

const serialize = (s: StatusRow) => ({
  id: s.id,
  userId: s.user_id,
  text: s.text,
  style: s.style,
  art: s.art ?? {},
  createdAt: s.created_at,
  expiresAt: s.expires_at,
  seen: s.seen,
  views: s.views,
});

/** Lets friends' apps refresh their story rows. */
async function announce(userId: number) {
  emitToUsers([userId, ...(await audienceOf(userId).catch(() => []))], 'status:changed', { userId });
}

/** Your statuses plus those of everyone you've added (who hasn't blocked you), grouped by person. */
router.get('/', async (req, res) => {
  const me = req.userId;
  const r = await query<StatusRow>(
    `SELECT s.*,
            EXISTS (SELECT 1 FROM status_views v WHERE v.status_id = s.id AND v.viewer_id = $1) AS seen,
            (SELECT count(*)::int FROM status_views v WHERE v.status_id = s.id) AS views
       FROM statuses s
      WHERE s.expires_at > now()
        AND (s.user_id = $1 OR (
              EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = $1 AND f.friend_id = s.user_id)
              AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = s.user_id AND b.blocked_id = $1)
                                                        OR (b.blocker_id = $1 AND b.blocked_id = s.user_id))))
      ORDER BY s.created_at`,
    [me],
  );
  const ids = [...new Set(r.rows.map((s) => s.user_id))];
  const users = ids.length ? await query<UserRow>(`SELECT ${USER_COLS} FROM users u WHERE u.id = ANY($1::bigint[])`, [ids]) : { rows: [] };
  const byId = new Map(users.rows.map((u) => [u.id, publicUser(u)]));
  const groups = ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const list = r.rows.filter((s) => s.user_id === id).map(serialize);
      // Only other people's views count for "seen"; your own are always seen.
      if (id === me) list.forEach((s) => (s.seen = true));
      return { user: byId.get(id)!, statuses: list, allSeen: list.every((s) => s.seen), latestAt: list[list.length - 1].createdAt };
    });
  res.json({ groups });
});

router.post('/', async (req, res) => {
  const body = parse(z.object({ text: z.string().trim().max(300).default(''), style: styleSchema, art: artSchema }), req.body);
  if (!body.text && !body.art.strokes.length && !body.art.stickers.length) throw fail(400, 'Write, draw or add a sticker first');
  const active = await one<{ n: number }>('SELECT count(*)::int AS n FROM statuses WHERE user_id = $1 AND expires_at > now()', [req.userId]);
  if ((active?.n ?? 0) >= MAX_ACTIVE) throw fail(429, 'You have lots of statuses up — delete one first');
  const s = await one<StatusRow>('INSERT INTO statuses (user_id, text, style, art) VALUES ($1, $2, $3, $4) RETURNING *, true AS seen, 0 AS views', [
    req.userId,
    body.text,
    JSON.stringify(body.style),
    JSON.stringify(body.art),
  ]);
  await announce(req.userId);
  res.status(201).json({ status: serialize(s!) });
});

router.delete('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const r = await query('DELETE FROM statuses WHERE id = $1 AND user_id = $2', [id, req.userId]);
  if (!r.rowCount) throw fail(404, 'Status not found');
  await announce(req.userId);
  res.json({ ok: true });
});

router.post('/:id/view', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const s = await one<{ user_id: number }>('SELECT user_id FROM statuses WHERE id = $1 AND expires_at > now()', [id]);
  if (!s) throw fail(404, 'Status not found');
  if (s.user_id !== req.userId) {
    const r = await query('INSERT INTO status_views (status_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.userId]);
    // The owner's view count goes up live.
    if (r.rowCount) emitToUsers([s.user_id], 'status:changed', { userId: s.user_id });
  }
  res.json({ ok: true });
});

/** Who saw one of your statuses. */
router.get('/:id/views', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const s = await one<{ user_id: number }>('SELECT user_id FROM statuses WHERE id = $1', [id]);
  if (!s || s.user_id !== req.userId) throw fail(404, 'Status not found');
  const r = await query<UserRow & { viewed_at: Date }>(
    `SELECT ${USER_COLS}, v.viewed_at FROM status_views v JOIN users u ON u.id = v.viewer_id WHERE v.status_id = $1 ORDER BY v.viewed_at DESC`,
    [id],
  );
  res.json({ viewers: r.rows.map((u) => ({ user: publicUser(u), viewedAt: u.viewed_at })) });
});

export default router;
