import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { parse } from '../http.js';

const router = Router();
const TOKEN = z.string().trim().min(20).max(4096);

/** The Android app registers its Firebase token after sign-in; a token always belongs to the latest user. */
router.post('/token', async (req, res) => {
  const { token, platform } = parse(z.object({ token: TOKEN, platform: z.enum(['android']).default('android') }), req.body);
  await query(
    `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [token, req.userId, platform],
  );
  res.json({ ok: true });
});

router.delete('/token', async (req, res) => {
  const { token } = parse(z.object({ token: TOKEN }), req.body);
  await query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, req.userId]);
  res.json({ ok: true });
});

export default router;
