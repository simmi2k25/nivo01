import { Router } from 'express';
import { z } from 'zod';
import { acknowledge, deviceOf, pendingFor } from '../delivery.js';
import { parse } from '../http.js';

const router = Router();

/** Messages this device hasn't stored yet (it calls again while `more` is true). */
router.get('/', async (req, res) => {
  const device = await deviceOf(req);
  res.json(await pendingFor(req.userId, device));
});

/** The device has stored everything up to these ids: { [conversationId]: messageId }. */
router.post('/ack', async (req, res) => {
  const { upTo } = parse(z.object({ upTo: z.record(z.string(), z.number().int().positive()) }), req.body);
  const device = await deviceOf(req);
  await acknowledge(req.userId, device, upTo);
  res.json({ ok: true });
});

export default router;
