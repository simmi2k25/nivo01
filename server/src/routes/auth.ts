import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../auth.js';
import { one, query } from '../db.js';
import { fail, parse } from '../http.js';
import { BUDDIES, getUser } from '../model.js';

export const USERNAME = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,20}$/, 'Use 3–20 letters, numbers, dots or underscores');

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes' },
});

// Compared against when the account doesn't exist, so timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('nivotalk-dummy-password', 11);

const router = Router();

router.post('/register', authLimit, async (req, res) => {
  const body = parse(
    z.object({
      username: USERNAME,
      email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
      password: z.string().min(8, 'Password needs at least 8 characters').max(128),
      displayName: z.string().trim().min(1).max(30).optional(),
      avatar: z.enum(BUDDIES).default('dino'),
      remember: z.boolean().default(true),
    }),
    req.body,
  );
  const clash = await one<{ username: string; email: string }>(
    'SELECT username, email FROM users WHERE username = $1 OR email = $2',
    [body.username, body.email],
  );
  if (clash) throw fail(409, clash.username === body.username ? 'That username is taken' : 'That email is already registered');

  const hash = await bcrypt.hash(body.password, 11);
  const row = await one<{ id: number }>(
    `INSERT INTO users (username, email, password_hash, display_name, avatar)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [body.username, body.email, hash, body.displayName || body.username, body.avatar],
  );
  setSessionCookie(res, row!.id, body.remember);
  res.status(201).json({ user: await getUser(row!.id) });
});

router.post('/login', authLimit, async (req, res) => {
  const body = parse(
    z.object({
      identifier: z.string().trim().toLowerCase().min(1, 'Enter your email or username').max(254),
      password: z.string().min(1, 'Enter your password').max(128),
      remember: z.boolean().default(true),
    }),
    req.body,
  );
  const row = await one<{ id: number; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE username = $1 OR email = $1',
    [body.identifier],
  );
  const ok = await bcrypt.compare(body.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw fail(401, 'Wrong email/username or password');
  setSessionCookie(res, row.id, body.remember);
  res.json({ user: await getUser(row.id) });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) {
    clearSessionCookie(res);
    throw fail(401, 'Please log in');
  }
  const extra = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.userId]);
  res.json({ user: { ...user, email: extra?.email } });
});

router.get('/check-username', async (req, res) => {
  const r = USERNAME.safeParse(req.query.username ?? '');
  if (!r.success) return res.json({ available: false, reason: r.error.issues[0]?.message });
  const taken = await query('SELECT 1 FROM users WHERE username = $1', [r.data]);
  res.json({ available: taken.rowCount === 0, reason: taken.rowCount ? 'That username is taken' : undefined });
});

export default router;
