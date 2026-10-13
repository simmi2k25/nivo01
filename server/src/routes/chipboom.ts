import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { fail, idParam, parse } from '../http.js';
import { getUser, isMember, postMessage } from '../model.js';
import { pushToUsers } from '../push.js';
import { CB_CODE, closeTable, createTable, findGame, leaveTable, MAX_STAKE, MIN_STAKE, tableInfo } from '../realtime/chipboom.js';
import { isForeground } from '../realtime/hub.js';

const router = Router();

const stake = z.number().int().min(MIN_STAKE, `Stake at least ${MIN_STAKE} coin`).max(MAX_STAKE, `Stakes go up to ${MAX_STAKE} coins`);

/** "Maya opened a Chip or Boom table" in the chat, plus a phone push for anyone not looking. */
async function announce(code: string, conversationId: number, userId: number, amount: number) {
  const me = await getUser(userId);
  const name = me?.displayName ?? 'Someone';
  await postMessage({
    conversationId,
    senderId: null,
    kind: 'system',
    body: `${name} wants to play Chip or Boom 💣 · ${amount} ${amount === 1 ? 'coin' : 'coins'} each`,
    meta: { event: 'chipboom', code, by: userId },
  });
  const members = await query<{ user_id: number }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND NOT muted',
    [conversationId, userId],
  );
  const away = members.rows.map((m) => m.user_id).filter((id) => !isForeground(id));
  if (away.length) {
    pushToUsers(away, { title: name, body: 'wants to play Chip or Boom — find chips, dodge bombs 💣', to: `/chipboom/${code}`, tag: `chipboom:${code}` }).catch((e) =>
      console.error('[push] chipboom', e.message),
    );
  }
}

router.post('/', async (req, res) => {
  const body = parse(z.object({ stake, conversationId: idParam.optional() }), req.body ?? {});
  if (body.conversationId && !(await isMember(body.conversationId, req.userId))) throw fail(404, 'Chat not found');
  const code = await createTable(req.userId, { stake: body.stake, conversationId: body.conversationId ?? null });
  if (body.conversationId) await announce(code, body.conversationId, req.userId, body.stake).catch(() => {});
  res.status(201).json({ code });
});

router.get('/:code', async (req, res) => {
  const code = parse(CB_CODE, req.params.code);
  const g = findGame(code);
  if (g) return res.json({ code, phase: g.phase, stake: g.stake });
  const row = await tableInfo(code);
  if (!row) throw fail(404, 'No table with that code');
  res.json({ code, phase: row.status, stake: row.stake });
});

router.post('/:code/leave', async (req, res) => {
  const code = parse(CB_CODE, req.params.code);
  await leaveTable(code, req.userId);
  res.json({ ok: true });
});

router.post('/:code/close', async (req, res) => {
  const code = parse(CB_CODE, req.params.code);
  const g = findGame(code);
  if (!g) return res.json({ ok: true });
  if (g.hostId !== req.userId) throw fail(403, 'Only the host can close the table');
  if (g.phase !== 'lobby') throw fail(409, 'The game has already started');
  await closeTable(g, 'The host closed the table — stakes were refunded');
  res.json({ ok: true });
});

router.post('/:code/invite', async (req, res) => {
  const code = parse(CB_CODE, req.params.code);
  const { conversationId } = parse(z.object({ conversationId: idParam }), req.body);
  const g = findGame(code);
  if (!g || g.phase !== 'lobby') throw fail(409, 'This table isn’t taking players any more');
  if (!(await isMember(conversationId, req.userId))) throw fail(404, 'Chat not found');
  await announce(code, conversationId, req.userId, g.stake);
  res.json({ ok: true });
});

export default router;
