import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { sniffImage } from '../images.js';
import { BUDDIES, broadcastUserUpdate, getUser, publicUser, USER_COLS, type UserRow } from '../model.js';
import { USERNAME } from './auth.js';

const router = Router();

const uploadLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `u${req.userId}`,
  message: { error: 'Too many changes — try again in a few minutes' },
});

router.patch('/me', async (req, res) => {
  const body = parse(
    z.object({
      displayName: z.string().trim().min(1, 'Name can’t be empty').max(30).optional(),
      bio: z.string().trim().max(150).optional(),
      avatar: z.enum(BUDDIES).optional(),
      themeColor: z.string().trim().max(20).regex(/^[a-z0-9#-]+$/).optional(),
    }),
    req.body,
  );
  await query(
    `UPDATE users SET
       display_name   = COALESCE($2, display_name),
       status_message = COALESCE($3, status_message),
       avatar         = COALESCE($4, avatar),
       theme_color    = COALESCE($5, theme_color)
     WHERE id = $1`,
    [req.userId, body.displayName ?? null, body.bio ?? null, body.avatar ?? null, body.themeColor ?? null],
  );
  await broadcastUserUpdate(req.userId);
  res.json({ user: await getUser(req.userId) });
});

// ---------- profile photo & background ----------

function imageRoutes(kind: 'avatar' | 'cover', maxBytes: number) {
  const column = kind === 'avatar' ? 'avatar_image_id' : 'cover_image_id';

  router.put(
    `/me/${kind}`,
    uploadLimit,
    express.raw({ type: () => true, limit: maxBytes }),
    async (req, res) => {
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || !buf.length) throw fail(400, 'No image received');
      const info = sniffImage(buf);
      if (!info) throw fail(415, 'Please use a JPEG, PNG or WebP image');
      if (info.width > 8000 || info.height > 8000) throw fail(413, 'That image is too large');

      await tx(async (c) => {
        const old = await c.query(`SELECT ${column} AS id FROM users WHERE id = $1 FOR UPDATE`, [req.userId]);
        const img = await c.query<{ id: number }>(
          'INSERT INTO profile_images (owner_id, kind, mime, data) VALUES ($1, $2, $3, $4) RETURNING id',
          [req.userId, kind, info.mime, buf],
        );
        await c.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [req.userId, img.rows[0].id]);
        if (old.rows[0]?.id) await c.query('DELETE FROM profile_images WHERE id = $1', [old.rows[0].id]);
      });
      await broadcastUserUpdate(req.userId);
      res.json({ user: await getUser(req.userId) });
    },
  );

  router.delete(`/me/${kind}`, async (req, res) => {
    await tx(async (c) => {
      const old = await c.query(`SELECT ${column} AS id FROM users WHERE id = $1 FOR UPDATE`, [req.userId]);
      await c.query(`UPDATE users SET ${column} = NULL WHERE id = $1`, [req.userId]);
      if (old.rows[0]?.id) await c.query('DELETE FROM profile_images WHERE id = $1', [old.rows[0].id]);
    });
    await broadcastUserUpdate(req.userId);
    res.json({ user: await getUser(req.userId) });
  });
}
imageRoutes('avatar', 2 * 1024 * 1024);
imageRoutes('cover', 5 * 1024 * 1024);

router.get('/images/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const img = await one<{ mime: string; data: Buffer }>('SELECT mime, data FROM profile_images WHERE id = $1', [id]);
  if (!img) throw fail(404, 'Image not found');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(img.mime).send(img.data);
});

// ---------- profile song (Apple Music) ----------

const APPLE_HOST = /(^|\.)(apple\.com|mzstatic\.com)$/;
const appleUrl = (v: unknown) => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && APPLE_HOST.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
};

router.put('/me/song', uploadLimit, async (req, res) => {
  const { trackId, country } = parse(
    z.object({ trackId: z.coerce.number().int().positive(), country: z.string().regex(/^[a-zA-Z]{2}$/).optional() }),
    req.body,
  );
  const params = new URLSearchParams({ id: String(trackId), entity: 'song' });
  if (country) params.set('country', country);
  const r = await fetch(`https://itunes.apple.com/lookup?${params}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw fail(502, 'Couldn’t reach Apple Music — try again');
  const data = (await r.json()) as { results?: any[] };
  const t = data.results?.find((x) => x.trackId === trackId);
  const previewUrl = appleUrl(t?.previewUrl);
  if (!t || !previewUrl) throw fail(404, 'That song has no preview available');
  const song = {
    trackId,
    title: String(t.trackName ?? '').slice(0, 200),
    artist: String(t.artistName ?? '').slice(0, 200),
    artwork: appleUrl(String(t.artworkUrl100 ?? '').replace('100x100bb', '300x300bb')),
    previewUrl,
    url: appleUrl(t.trackViewUrl),
  };
  await query('UPDATE users SET profile_song = $2 WHERE id = $1', [req.userId, JSON.stringify(song)]);
  await broadcastUserUpdate(req.userId);
  res.json({ user: await getUser(req.userId) });
});

router.delete('/me/song', async (req, res) => {
  await query('UPDATE users SET profile_song = NULL WHERE id = $1', [req.userId]);
  await broadcastUserUpdate(req.userId);
  res.json({ user: await getUser(req.userId) });
});

/** Fallback for clients whose network blocks direct calls to Apple's search API. */
router.get('/song-search', async (req, res) => {
  const { q, country } = parse(
    z.object({ q: z.string().trim().min(1).max(100), country: z.string().regex(/^[a-zA-Z]{2}$/).default('US') }),
    req.query,
  );
  const params = new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '25', country });
  const r = await fetch(`https://itunes.apple.com/search?${params}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw fail(502, 'Couldn’t reach Apple Music');
  res.json(await r.json());
});

// ---------- people ----------

router.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(40).default('') }), req.query);
  if (!q) return res.json({ users: [] });
  const like = q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`) + '%';
  const r = await query<UserRow & { is_friend: boolean }>(
    `SELECT ${USER_COLS},
            EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = $1 AND f.friend_id = u.id) AS is_friend
       FROM users u
      WHERE u.id <> $1 AND (u.username LIKE $2 OR lower(u.display_name) LIKE $2)
      ORDER BY (u.username = $3) DESC, u.username
      LIMIT 12`,
    [req.userId, like, q.toLowerCase()],
  );
  res.json({ users: r.rows.map((u) => ({ ...publicUser(u), isFriend: u.is_friend })) });
});

router.get('/:username', async (req, res) => {
  const username = parse(USERNAME, req.params.username);
  const u = await one<UserRow & { is_friend: boolean; added_me: boolean; favorite: boolean; friend_count: number }>(
    `SELECT ${USER_COLS},
            EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = $1 AND f.friend_id = u.id) AS is_friend,
            EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = u.id AND f.friend_id = $1) AS added_me,
            (SELECT count(*)::int FROM friendships f WHERE f.user_id = u.id) AS friend_count
       FROM users u WHERE u.username = $2`,
    [req.userId, username],
  );
  if (!u) throw fail(404, 'No one here by that name');
  res.json({
    user: {
      ...publicUser(u),
      isFriend: u.is_friend,
      addedMe: u.added_me,
      friendCount: u.friend_count,
      isMe: u.id === req.userId,
    },
  });
});

export default router;
