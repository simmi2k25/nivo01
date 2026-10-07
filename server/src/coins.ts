import type pg from 'pg';
import { config } from './config.js';
import { pool } from './db.js';
import { fail } from './http.js';
import { emitToUsers } from './realtime/hub.js';

/** What things cost, in coins. Change prices here. */
export const PRICES = {
  memorySmall: 3, // +2 Memories slots
  memoryLarge: 5, // +5 Memories slots
  wallpaper: 5, // set a chat background for everyone in the chat
  groupCreate: 5, // start a group chat
  groupJoin: 1, // accept a group invitation
  watermark: 2, // strips from one photobooth without the NivoTalk wordmark
} as const;

export const MEMORY_PACKS = {
  small: { cost: PRICES.memorySmall, slots: 2 },
  large: { cost: PRICES.memoryLarge, slots: 5 },
} as const;

/** Coin packs sold in the store. `inr` is the price in rupees. */
export const COIN_PACKS = [
  { id: 'c100', coins: 100, inr: 49 },
  { id: 'c250', coins: 250, inr: 99 },
  { id: 'c600', coins: 600, inr: 199, tag: 'Best value' },
] as const;

/** Until a payment provider is connected, "Buy" only works when COINS_TEST_MODE is on (default outside production). */
export const coinsTestMode = () => process.env.COINS_TEST_MODE === 'true' || (!config.isProd && process.env.COINS_TEST_MODE !== 'false');

type Db = pg.Pool | pg.PoolClient;

/** Takes coins in the caller's transaction, or fails with 402 when the balance is too low. */
export async function spend(db: Db, userId: number, amount: number, reason: string, ref: Record<string, unknown> = {}) {
  const r = await db.query<{ coins: number }>(
    'UPDATE users SET coins = coins - $2 WHERE id = $1 AND coins >= $2 RETURNING coins',
    [userId, amount],
  );
  if (!r.rowCount) throw fail(402, `You need ${amount} ${amount === 1 ? 'coin' : 'coins'} for this — top up in the coin store`);
  await db.query('INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4)', [userId, -amount, reason, ref]);
  return r.rows[0].coins;
}

export async function grant(db: Db, userId: number, amount: number, reason: string, ref: Record<string, unknown> = {}) {
  const r = await db.query<{ coins: number }>('UPDATE users SET coins = coins + $2 WHERE id = $1 RETURNING coins', [userId, amount]);
  await db.query('INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4)', [userId, amount, reason, ref]);
  return r.rows[0]?.coins ?? 0;
}

/** Tells someone's open apps their new balance (call after the transaction commits). */
export async function pushBalance(userId: number) {
  const r = await pool.query<{ coins: number; memory_slots: number }>('SELECT coins, memory_slots FROM users WHERE id = $1', [userId]);
  if (r.rows[0]) emitToUsers([userId], 'coins:changed', { coins: r.rows[0].coins, memorySlots: r.rows[0].memory_slots });
}
