import { Router } from 'express';
import { z } from 'zod';
import { fail, idParam, parse } from '../http.js';
import { getUser, isMember, postMessage } from '../model.js';
import { pushToUsers } from '../push.js';
import { query } from '../db.js';
import { isForeground } from '../realtime/hub.js';
import { createTable, findGame, leaveTable, MAX_BET, MIN_BET, seatPlayer, tableInfo, UNO_CODE } from '../realtime/uno.js';

const router = Router();

const bet = z.number().int().min(MIN_BET, `Bet at least ${MIN_BET} coin`).max(MAX_BET, `Bets go up to ${MAX_BET} coins`);

/** "Maya opened an UNO table" in the chat, plus a phone push for anyone not looking. */
async function announce(code: string, conversationId: number, userId: number, range: { min: number; max: number }) {
  const me = await getUser(userId);
  const name = me?.displayName ?? 'Someone';
  await postMessage({
    conversationId,
    senderId: null,
    kind: 'system',
    body: `${name} opened a NivoTalk Cards table 🃏 · bets ${range.min}–${range.max} coins`,
    meta: { event: 'uno', code, by: userId },
  });
  const members = await query<{ user_id: number }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND NOT muted',
    [conversationId, userId],
  );
  const away = members.rows.map((m) => m.user_id).filter((id) => !isForeground(id));
  if (away.length) {
    pushToUsers(away, { title: name, body: 'opened a NivoTalk Cards table — bet coins and play 🃏', to: `/uno/${code}`, tag: `uno:${code}` }).catch((e) =>
      console.error('[push] uno', e.message),
    );
  }
}

router.post('/', async (req, res) => {
  const body = parse(
    z
      .object({ minBet: bet, maxBet: bet, bet, conversationId: idParam.optional() })
      .refine((b) => b.minBet <= b.maxBet, { message: 'The lowest bet can’t be above the highest', path: ['minBet'] })
      .refine((b) => b.bet >= b.minBet && b.bet <= b.maxBet, { message: 'Your bet has to be inside the range you set', path: ['bet'] }),
    req.body ?? {},
  );
  if (body.conversationId && !(await isMember(body.conversationId, req.userId))) throw fail(404, 'Chat not found');
  const code = await createTable(req.userId, { minBet: body.minBet, maxBet: body.maxBet, bet: body.bet, conversationId: body.conversationId ?? null });
  if (body.conversationId) await announce(code, body.conversationId, req.userId, { min: body.minBet, max: body.maxBet }).catch(() => {});
  res.status(201).json({ code });
});

router.get('/:code', async (req, res) => {
  const code = parse(UNO_CODE, req.params.code);
  const g = findGame(code);
  if (g) return res.json({ code, phase: g.phase, minBet: g.minBet, maxBet: g.maxBet });
  const row = await tableInfo(code);
  if (!row) throw fail(404, 'No table with that code');
  res.json({ code, phase: row.status });
});

router.post('/:code/sit', async (req, res) => {
  const code = parse(UNO_CODE, req.params.code);
  const body = parse(z.object({ bet }), req.body ?? {});
  await seatPlayer(code, req.userId, body.bet);
  res.json({ ok: true });
});

router.post('/:code/leave', async (req, res) => {
  const code = parse(UNO_CODE, req.params.code);
  await leaveTable(code, req.userId);
  res.json({ ok: true });
});

router.post('/:code/invite', async (req, res) => {
  const code = parse(UNO_CODE, req.params.code);
  const { conversationId } = parse(z.object({ conversationId: idParam }), req.body);
  const g = findGame(code);
  if (!g || g.phase !== 'lobby') throw fail(409, 'This table isn’t taking players any more');
  if (!(await isMember(conversationId, req.userId))) throw fail(404, 'Chat not found');
  await announce(code, conversationId, req.userId, { min: g.minBet, max: g.maxBet });
  res.json({ ok: true });
});

export default router;
