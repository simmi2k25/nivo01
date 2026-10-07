import { Router } from 'express';
import { z } from 'zod';
import { COIN_PACKS, coinsTestMode, grant, MEMORY_PACKS, PRICES, pushBalance, spend } from '../coins.js';
import { one, query, tx } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { blockBetween, getUser, postMessage } from '../model.js';
import { pushToUsers } from '../push.js';
import { emitToUsers } from '../realtime/hub.js';
import { ROOM_CODE } from './rooms.js';

const router = Router();

/** Balance, Memories slots, prices, packs and recent history for the coin store. */
router.get('/', async (req, res) => {
  const u = await one<{ coins: number; memory_slots: number }>('SELECT coins, memory_slots FROM users WHERE id = $1', [req.userId]);
  const history = await query<{ id: number; delta: number; reason: string; ref: Record<string, unknown>; created_at: Date }>(
    'SELECT id, delta, reason, ref, created_at FROM coin_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30',
    [req.userId],
  );
  res.json({
    coins: u?.coins ?? 0,
    memorySlots: u?.memory_slots ?? 5,
    prices: PRICES,
    memoryPacks: MEMORY_PACKS,
    packs: COIN_PACKS,
    canBuy: coinsTestMode(),
    history: history.rows.map((h) => ({ id: h.id, delta: h.delta, reason: h.reason, ref: h.ref, createdAt: h.created_at })),
  });
});

/** Test mode only until a payment provider is connected: adds the pack's coins without charging. */
router.post('/buy', async (req, res) => {
  const { packId } = parse(z.object({ packId: z.string() }), req.body);
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) throw fail(400, 'Unknown coin pack');
  if (!coinsTestMode()) throw fail(503, 'Buying coins is coming soon 💛');
  const coins = await tx((c) => grant(c, req.userId, pack.coins, 'purchase', { packId, inr: pack.inr, test: true }));
  await pushBalance(req.userId);
  res.json({ coins });
});

/** Extra Memories slots: small = +2 for 3 coins, large = +5 for 5 coins. */
router.post('/memory', async (req, res) => {
  const { pack } = parse(z.object({ pack: z.enum(['small', 'large']) }), req.body);
  const p = MEMORY_PACKS[pack];
  const out = await tx(async (c) => {
    const coins = await spend(c, req.userId, p.cost, 'memory', { slots: p.slots });
    const r = await c.query<{ memory_slots: number }>(
      'UPDATE users SET memory_slots = memory_slots + $2 WHERE id = $1 RETURNING memory_slots',
      [req.userId, p.slots],
    );
    return { coins, memorySlots: r.rows[0].memory_slots };
  });
  await pushBalance(req.userId);
  res.json(out);
});

/** Send coins to a friend. A note appears in your chat with them. */
router.post('/gift', async (req, res) => {
  const { userId, amount, note } = parse(
    z.object({
      userId: idParam,
      amount: z.number().int().min(1, 'Send at least 1 coin').max(1000, 'You can send up to 1,000 coins at a time'),
      note: z.string().trim().max(80).optional(),
    }),
    req.body,
  );
  if (userId === req.userId) throw fail(400, 'You can’t gift yourself');
  const friends = await one(
    'SELECT 1 FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1) LIMIT 1',
    [req.userId, userId],
  );
  if (!friends || (await blockBetween(req.userId, userId))) throw fail(403, 'You can only send coins to friends');

  const coins = await tx(async (c) => {
    const left = await spend(c, req.userId, amount, 'gift_sent', { to: userId });
    await grant(c, userId, amount, 'gift_received', { from: req.userId });
    return left;
  });
  await pushBalance(req.userId);
  await pushBalance(userId);

  const [me, them] = await Promise.all([getUser(req.userId), getUser(userId)]);
  const word = amount === 1 ? 'coin' : 'coins';
  // Drop a line in their direct chat, creating it if needed.
  const key = [req.userId, userId].sort((a, b) => a - b).join(':');
  let conv = await one<{ id: number }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
  if (!conv) {
    conv = await tx(async (c) => {
      const ins = await c.query<{ id: number }>(
        `INSERT INTO conversations (is_group, direct_key, created_by) VALUES (false, $1, $2)
         ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key RETURNING id`,
        [key, req.userId],
      );
      await c.query(
        `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
        [ins.rows[0].id, req.userId, userId],
      );
      return ins.rows[0];
    });
  }
  await postMessage({
    conversationId: conv.id,
    senderId: null,
    kind: 'system',
    body: `🪙 ${me?.displayName ?? 'Someone'} sent ${them?.displayName ?? 'you'} ${amount} ${word}${note ? ` — “${note}”` : ''}`,
    meta: { event: 'gift', from: req.userId, to: userId, amount },
  });
  emitToUsers([userId], 'coins:gift', { from: me, amount, note: note ?? null });
  pushToUsers([userId], {
    title: `${me?.displayName ?? 'A friend'} sent you ${amount} ${word} 🪙`,
    body: note || 'Open NivoTalk to see your balance',
    to: `/chats/${conv.id}`,
    tag: `gift:${req.userId}`,
  }).catch(() => {});
  res.json({ coins });
});

/** Whether you've removed the wordmark for this photobooth. */
router.get('/watermark/:code', async (req, res) => {
  const code = parse(ROOM_CODE, req.params.code);
  const r = await one('SELECT 1 FROM booth_unlocks WHERE room_code = $1 AND user_id = $2', [code, req.userId]);
  res.json({ unlocked: !!r, price: PRICES.watermark });
});

/** Pay once per photobooth to save strips without the NivoTalk wordmark. */
router.post('/watermark/:code', async (req, res) => {
  const code = parse(ROOM_CODE, req.params.code);
  const room = await one('SELECT 1 FROM booth_rooms WHERE code = $1', [code]);
  if (!room) throw fail(404, 'No booth with that code');
  const coins = await tx(async (c) => {
    const ins = await c.query(
      'INSERT INTO booth_unlocks (room_code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [code, req.userId],
    );
    if (!ins.rowCount) return null; // already unlocked — don't charge twice
    return spend(c, req.userId, PRICES.watermark, 'watermark', { roomCode: code });
  });
  await pushBalance(req.userId);
  res.json({ unlocked: true, coins });
});

export default router;
