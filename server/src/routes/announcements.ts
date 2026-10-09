import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { getUser } from '../model.js';
import { pushToUsers } from '../push.js';
import { getIo } from '../realtime/hub.js';

/** Announcements from the official NivoTalk account, shown to everyone. */
const router = Router();

type Row = { id: number; author_id: number | null; title: string; body: string; created_at: Date };

async function serialize(rows: Row[]) {
  const authors = new Map<number, Awaited<ReturnType<typeof getUser>>>();
  for (const id of new Set(rows.map((r) => r.author_id).filter((x): x is number => !!x))) authors.set(id, await getUser(id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    author: r.author_id ? (authors.get(r.author_id) ?? null) : null,
  }));
}

async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const u = await one<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
  if (!u?.is_admin) return next(fail(403, 'Only NivoTalk admins can do that'));
  next();
}

router.get('/', async (_req, res) => {
  const r = await query<Row>('SELECT * FROM announcements ORDER BY id DESC LIMIT 30');
  res.json({ announcements: await serialize(r.rows) });
});

router.post('/', requireAdmin, async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().max(80).default(''),
      body: z.string().trim().min(1, 'Write something to announce').max(2000),
      notify: z.boolean().default(true),
    }),
    req.body,
  );
  const row = await one<Row>('INSERT INTO announcements (author_id, title, body) VALUES ($1, $2, $3) RETURNING *', [
    req.userId,
    body.title,
    body.body,
  ]);
  const [announcement] = await serialize([row!]);
  // Everyone online sees it right away; everyone else gets a phone notification.
  getIo().emit('announcement:new', announcement);
  if (body.notify) {
    const everyone = await query<{ id: number }>('SELECT id FROM users WHERE id <> $1', [req.userId]);
    pushToUsers(
      everyone.rows.map((u) => u.id),
      {
        title: body.title || 'NivoTalk',
        body: body.body.length > 180 ? `${body.body.slice(0, 179)}…` : body.body,
        to: '/chats?news=1',
        tag: `announcement:${row!.id}`,
      },
    ).catch((e) => console.error('[push] announcement', e.message));
  }
  res.status(201).json({ announcement });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parse(idParam, req.params.id);
  const r = await query('DELETE FROM announcements WHERE id = $1', [id]);
  if (!r.rowCount) throw fail(404, 'Announcement not found');
  getIo().emit('announcement:deleted', { id });
  res.json({ ok: true });
});

export default router;
