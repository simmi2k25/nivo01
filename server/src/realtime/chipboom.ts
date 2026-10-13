import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { grant, pushBalance, spend } from '../coins.js';
import { one, query, tx } from '../db.js';
import { fail } from '../http.js';
import { getUser, postMessage, STICKER_ID, type PublicUser } from '../model.js';
import { notifyTogether } from './chill.js';
import { getIo } from './hub.js';
import { registerVoiceGame } from './voice.js';

/**
 * Chip or Boom. Two players, a blue grid and a pink grid of 16 face-down tiles each: most hide a chip,
 * some hide a bomb. Players take turns flipping one tile on their own grid; a chip scores, a bomb costs
 * a life. First to 8 chips — or the last one with lives left — takes the pot. The server deals the
 * grids and never sends a tile before it's flipped, so nobody can peek.
 */

export const CB_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'That table code doesn’t look right');

export const MIN_STAKE = 1;
export const MAX_STAKE = 100;
const TILES = 16;
const BOMBS = 6;
export const TARGET = 8;
export const LIVES = 3;
const TURN_MS = 20_000;
/** Turns timed out in a row before a player is counted as gone. */
const MAX_MISSED = 3;
const LOBBY_TTL_MS = 30 * 60_000;
const FINISHED_TTL_MS = 10 * 60_000;
const KEEP_EVENTS = 12;
const MAX_COMMENT = 80;

export type Side = 'blue' | 'pink';
const SIDES: Side[] = ['blue', 'pink'];
const other = (s: Side): Side => (s === 'blue' ? 'pink' : 'blue');

type Person = { id: number; displayName: string; avatar: string; avatarUrl: string | null };
type Tile = 'chip' | 'bomb';

type Seat = {
  userId: number;
  user: Person;
  /** Stake taken: the coins are in cb_seats until someone wins (or it's refunded). */
  ready: boolean;
  grid: Tile[];
  revealed: boolean[];
  chips: number;
  lives: number;
  missed: number;
};

export type CbEvent = {
  seq: number;
  type: 'reveal' | 'timeout' | 'forfeit' | 'win' | 'start';
  by?: number;
  side?: Side;
  index?: number;
  tile?: Tile;
  amount?: number;
};

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

type Game = {
  id: number;
  code: string;
  hostId: number;
  conversationId: number | null;
  stake: number;
  phase: Phase;
  seats: Record<Side, Seat | null>;
  /** Moves while ready (taking coins) is in flight, so one person can't pay twice. */
  paying: Set<number>;
  turn: Side;
  /** Who moved first; a round is over each time the turn comes back to them. */
  first: Side;
  round: number;
  turnEndsAt: number;
  winnerId: number | null;
  payout: number;
  events: CbEvent[];
  seq: number;
  watchers: Map<string, number>;
  turnTimer: NodeJS.Timeout | null;
  expireTimer: NodeJS.Timeout | null;
  liveTimer: NodeJS.Timeout | null;
};

type TableRow = { id: number; code: string; host_id: number; conversation_id: number | null; stake: number; status: Phase };

const games = new Map<string, Game>();
const roomOf = (code: string) => `cb:${code}`;
const person = (u: PublicUser): Person => ({ id: u.id, displayName: u.displayName, avatar: u.avatar, avatarUrl: u.avatarUrl });
const sideOf = (g: Game, userId: number): Side | null => SIDES.find((s) => g.seats[s]?.userId === userId) ?? null;
const seated = (g: Game) => SIDES.map((s) => g.seats[s]).filter((s): s is Seat => !!s);
const potOf = (g: Game) => seated(g).filter((s) => s.ready).length * g.stake;
const isWatching = (g: Game, userId: number) => [...g.watchers.values()].includes(userId);

function newGrid(): Tile[] {
  const tiles: Tile[] = [...Array(TILES - BOMBS).fill('chip'), ...Array(BOMBS).fill('bomb')];
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

const emptySeat = (user: Person): Seat => ({ userId: user.id, user, ready: false, grid: [], revealed: Array(TILES).fill(false), chips: 0, lives: LIVES, missed: 0 });

// ---------- state sent to phones (the same for everyone: unflipped tiles stay secret from all) ----------

function seatState(g: Game, s: Seat | null) {
  if (!s) return null;
  return {
    user: s.user,
    ready: s.ready,
    online: isWatching(g, s.userId),
    chips: s.chips,
    lives: s.lives,
    tiles: s.revealed.map((r, i) => (r ? s.grid[i] : null)),
  };
}

function stateOf(g: Game) {
  const playing = g.phase === 'playing';
  return {
    code: g.code,
    hostId: g.hostId,
    conversationId: g.conversationId,
    stake: g.stake,
    phase: g.phase,
    pot: potOf(g),
    target: TARGET,
    lives: LIVES,
    blue: seatState(g, g.seats.blue),
    pink: seatState(g, g.seats.pink),
    turn: playing ? g.turn : null,
    round: g.round,
    turnEndsAt: playing ? g.turnEndsAt : null,
    turnMs: TURN_MS,
    winnerId: g.winnerId,
    payout: g.payout,
    events: g.events,
    serverNow: Date.now(),
  };
}

function broadcast(g: Game) {
  getIo().to(roomOf(g.code)).emit('cb:state', stateOf(g));
  scheduleLive(g);
}

function push(g: Game, e: Omit<CbEvent, 'seq'>) {
  g.events.push({ ...e, seq: ++g.seq });
  if (g.events.length > KEEP_EVENTS) g.events.splice(0, g.events.length - KEEP_EVENTS);
}

function scheduleLive(g: Game) {
  if (g.liveTimer) return;
  g.liveTimer = setTimeout(() => {
    g.liveTimer = null;
    notifyTogether(g.hostId, g.conversationId);
  }, 1200);
}

function clearTimers(g: Game) {
  for (const t of [g.turnTimer, g.expireTimer, g.liveTimer]) if (t) clearTimeout(t);
  g.turnTimer = g.expireTimer = g.liveTimer = null;
}

/** Tables friends can see on the Together tab. */
export function liveChipBoomTables() {
  return [...games.values()]
    .filter((g) => g.phase === 'lobby' || g.phase === 'playing')
    .map((g) => ({ code: g.code, hostId: g.hostId, conversationId: g.conversationId, phase: g.phase, players: seated(g).map((s) => s.user), stake: g.stake, pot: potOf(g) }));
}

// ---------- coins ----------

/** Gives stakes back. `userIds` refunds (and removes) just those seats; null refunds everyone left. */
async function refund(tableId: number, code: string, userIds: number[] | null) {
  const rows = await tx(async (c) => {
    const r = userIds
      ? await c.query<{ user_id: number; bet: number }>(
          'DELETE FROM cb_seats WHERE table_id = $1 AND NOT settled AND user_id = ANY($2::bigint[]) RETURNING user_id, bet',
          [tableId, userIds],
        )
      : await c.query<{ user_id: number; bet: number }>('UPDATE cb_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING user_id, bet', [tableId]);
    for (const row of r.rows) await grant(c, row.user_id, row.bet, 'cb_refund', { code });
    return r.rows;
  });
  for (const row of rows) await pushBalance(row.user_id).catch(() => {});
}

/** After a restart the games are gone: close them and hand every stake back. */
export async function recoverChipBoomTables() {
  const r = await query<{ id: number; code: string }>(`UPDATE cb_tables SET status = 'closed' WHERE status IN ('lobby','playing') RETURNING id, code`);
  for (const t of r.rows) await refund(t.id, t.code, null).catch((e) => console.error('[chipboom] refund on restart failed', t.code, e.message));
  if (r.rowCount) console.log(`[chipboom] closed ${r.rowCount} unfinished table(s) and refunded the stakes`);
}

// ---------- lobby ----------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/** Opens a table with the host on the blue side; nobody pays until they tap Ready. */
export async function createTable(userId: number, opts: { stake: number; conversationId: number | null }) {
  const user = await getUser(userId);
  if (!user) throw fail(401, 'Please log in again');
  let row: TableRow | undefined;
  for (let i = 0; i < 5 && !row; i++) {
    row = await one<TableRow>(
      `INSERT INTO cb_tables (code, host_id, conversation_id, stake) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [newCode(), userId, opts.conversationId, opts.stake],
    );
  }
  if (!row) throw fail(500, 'Couldn’t open a table — try again');
  const g: Game = {
    id: row.id,
    code: row.code,
    hostId: userId,
    conversationId: row.conversation_id,
    stake: row.stake,
    phase: 'lobby',
    seats: { blue: emptySeat(person(user)), pink: null },
    paying: new Set(),
    turn: 'blue',
    first: 'blue',
    round: 0,
    turnEndsAt: 0,
    winnerId: null,
    payout: 0,
    events: [],
    seq: 0,
    watchers: new Map(),
    turnTimer: null,
    expireTimer: null,
    liveTimer: null,
  };
  g.expireTimer = setTimeout(() => g.phase === 'lobby' && closeTable(g, 'The table timed out before the game started — stakes were refunded'), LOBBY_TTL_MS);
  games.set(g.code, g);
  notifyTogether(userId, g.conversationId);
  return g.code;
}

export const findGame = (code: string) => games.get(code) ?? null;

// Players at the table can talk; onlookers can't.
registerVoiceGame('cb', (code, userId) => {
  const g = games.get(code);
  return !!g && g.phase !== 'closed' && !!sideOf(g, userId);
});

export async function tableInfo(code: string) {
  return one<{ code: string; status: Phase; stake: number }>('SELECT code, status, stake FROM cb_tables WHERE code = $1', [code]);
}

/** Take a side (or swap to the empty one). Only while you haven't paid yet. */
async function chooseSide(g: Game, userId: number, side: Side): Promise<string | null> {
  if (g.phase !== 'lobby') return 'The game has already started';
  const mine = sideOf(g, userId);
  if (mine === side) return null;
  if (g.seats[side]) return `${g.seats[side]!.user.displayName} is already on that side`;
  if (mine) {
    if (g.seats[mine]!.ready || g.paying.has(userId)) return 'Tap “Not ready” first to switch sides';
    g.seats[side] = g.seats[mine];
    g.seats[mine] = null;
    return null;
  }
  const user = await getUser(userId);
  if (!user) return 'Please log in again';
  if (g.seats[side] || sideOf(g, userId)) return 'That seat was just taken';
  g.seats[side] = emptySeat(person(user));
  return null;
}

/** Ready = your stake goes in. When both sides are ready the game starts. */
async function ready(g: Game, userId: number): Promise<string | null> {
  const side = sideOf(g, userId);
  if (g.phase !== 'lobby') return 'The game has already started';
  if (!side) return 'Pick a side first';
  const seat = g.seats[side]!;
  if (seat.ready || g.paying.has(userId)) return null;
  g.paying.add(userId);
  try {
    await tx(async (c) => {
      const ins = await c.query('INSERT INTO cb_seats (table_id, user_id, side, bet) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [g.id, userId, side, g.stake]);
      if (!ins.rowCount) throw fail(409, 'You’re already in this game');
      await spend(c, userId, g.stake, 'cb_bet', { code: g.code });
    });
  } catch (e) {
    return (e as Error).message || 'Couldn’t take your stake';
  } finally {
    g.paying.delete(userId);
  }
  await pushBalance(userId).catch(() => {});
  // The table may have closed, or you may have left, while the coins moved.
  if (games.get(g.code) !== g || g.phase !== 'lobby' || g.seats[side]?.userId !== userId) {
    await refund(g.id, g.code, [userId]);
    return 'The table changed while you were getting ready — your coins are back';
  }
  seat.ready = true;
  if (g.seats.blue?.ready && g.seats.pink?.ready) startGame(g);
  return null;
}

async function unready(g: Game, userId: number): Promise<string | null> {
  const side = sideOf(g, userId);
  if (g.phase !== 'lobby' || !side || !g.seats[side]!.ready) return null;
  g.seats[side]!.ready = false;
  await refund(g.id, g.code, [userId]);
  return null;
}

/** Leaving the lobby refunds your stake (the host leaving closes the table); leaving a game gives it up. */
export async function leaveTable(code: string, userId: number) {
  const g = games.get(code);
  const side = g && sideOf(g, userId);
  if (!g || !side) return;
  if (g.phase === 'lobby') {
    if (userId === g.hostId) return closeTable(g, 'The host closed the table — stakes were refunded');
    const wasReady = g.seats[side]!.ready;
    g.seats[side] = null;
    broadcast(g);
    if (wasReady) await refund(g.id, code, [userId]);
  } else if (g.phase === 'playing') {
    forfeit(g, side);
    broadcast(g);
  }
}

export async function closeTable(g: Game, reason: string) {
  if (g.phase === 'closed' || g.phase === 'finished') return;
  g.phase = 'closed';
  clearTimers(g);
  games.delete(g.code);
  const io = getIo();
  io.to(roomOf(g.code)).emit('cb:closed', { code: g.code, reason });
  io.in(roomOf(g.code)).socketsLeave(roomOf(g.code));
  try {
    await refund(g.id, g.code, null);
    await query(`UPDATE cb_tables SET status = 'closed' WHERE id = $1`, [g.id]);
  } catch (e) {
    console.error('[chipboom] close refund failed', g.code, (e as Error).message);
  }
  notifyTogether(g.hostId, g.conversationId);
}

// ---------- the game ----------

function startGame(g: Game) {
  g.phase = 'playing';
  for (const s of seated(g)) Object.assign(s, { grid: newGrid(), revealed: Array(TILES).fill(false), chips: 0, lives: LIVES, missed: 0 });
  g.first = SIDES[crypto.randomInt(2)];
  g.round = 1;
  push(g, { type: 'start', side: g.first });
  startTurn(g, g.first);
  if (g.expireTimer) clearTimeout(g.expireTimer);
  g.expireTimer = null;
  query(`UPDATE cb_tables SET status = 'playing' WHERE id = $1`, [g.id]).catch((e) => console.error('[chipboom] start save failed', e.message));
}

function startTurn(g: Game, side: Side) {
  g.turn = side;
  g.turnEndsAt = Date.now() + TURN_MS;
  if (g.turnTimer) clearTimeout(g.turnTimer);
  const at = g.turnEndsAt;
  g.turnTimer = setTimeout(() => {
    if (g.phase === 'playing' && g.turn === side && g.turnEndsAt === at) onTimeout(g, side);
  }, TURN_MS);
}

/** Out of time: a random tile is flipped for you. Three in a row and you're out. */
function onTimeout(g: Game, side: Side) {
  const seat = g.seats[side]!;
  seat.missed++;
  push(g, { type: 'timeout', by: seat.userId, side });
  if (seat.missed >= MAX_MISSED) {
    forfeit(g, side);
    return broadcast(g);
  }
  const hidden = seat.revealed.flatMap((r, i) => (r ? [] : [i]));
  flip(g, side, hidden[crypto.randomInt(hidden.length)]);
  broadcast(g);
}

function flip(g: Game, side: Side, index: number) {
  const seat = g.seats[side]!;
  seat.revealed[index] = true;
  const tile = seat.grid[index];
  if (tile === 'chip') seat.chips++;
  else seat.lives--;
  push(g, { type: 'reveal', by: seat.userId, side, index, tile });
  if (seat.chips >= TARGET) return finish(g, side);
  if (seat.lives <= 0) return finish(g, other(side));
  const next = other(side);
  if (next === g.first) g.round++;
  startTurn(g, next);
}

function reveal(g: Game, side: Side, index: unknown): string | null {
  const seat = g.seats[side]!;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= TILES) return 'Pick a tile';
  if (seat.revealed[index as number]) return 'That tile is already flipped';
  seat.missed = 0;
  flip(g, side, index as number);
  return null;
}

function forfeit(g: Game, side: Side) {
  push(g, { type: 'forfeit', by: g.seats[side]!.userId, side });
  finish(g, other(side));
}

function finish(g: Game, side: Side) {
  const winner = g.seats[side]!;
  g.phase = 'finished';
  g.winnerId = winner.userId;
  g.payout = potOf(g);
  clearTimers(g);
  push(g, { type: 'win', by: winner.userId, side, amount: g.payout });
  settle(g, winner).finally(() => broadcast(g));
  setTimeout(() => games.get(g.code) === g && games.delete(g.code), FINISHED_TTL_MS).unref();
}

/** Pays the whole pot to the winner and drops a note in the linked chat. */
async function settle(g: Game, winner: Seat) {
  try {
    const pot = await tx(async (c) => {
      const r = await c.query<{ bet: number }>('UPDATE cb_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING bet', [g.id]);
      const total = r.rows.reduce((n, x) => n + x.bet, 0);
      if (total) await grant(c, winner.userId, total, 'cb_win', { code: g.code });
      await c.query(`UPDATE cb_tables SET status = 'finished', winner_id = $2, pot = $3, finished_at = now() WHERE id = $1`, [g.id, winner.userId, total]);
      return total;
    });
    g.payout = pot;
    await Promise.all(seated(g).map((s) => pushBalance(s.userId).catch(() => {})));
    if (g.conversationId) {
      await postMessage({
        conversationId: g.conversationId,
        senderId: null,
        kind: 'system',
        body: `🏆 ${winner.user.displayName} won ${pot} ${pot === 1 ? 'coin' : 'coins'} at Chip or Boom`,
        meta: { event: 'chipboom_win', code: g.code, by: winner.userId, amount: pot },
      });
    }
  } catch (e) {
    console.error('[chipboom] payout failed', g.code, e);
  }
  notifyTogether(g.hostId, g.conversationId);
}

// ---------- socket API ----------

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachChipBoom(socket: Socket) {
  const userId: number = socket.data.userId;
  const watching = new Set<string>();
  let lastMove = 0;
  let lastReact = 0;
  let lastSay = 0;

  const gameFor = (raw: unknown) => {
    const parsed = CB_CODE.safeParse(raw);
    return parsed.success ? (games.get(parsed.data) ?? null) : null;
  };

  socket.on('cb:join', async (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const parsed = CB_CODE.safeParse(payload?.code);
    if (!parsed.success) return ack({ error: 'That table code doesn’t look right' });
    const g = games.get(parsed.data);
    if (!g) {
      const row = await tableInfo(parsed.data).catch(() => undefined);
      return ack({ error: row?.status === 'finished' ? 'This game has ended' : 'This table has closed', closed: true });
    }
    g.watchers.set(socket.id, userId);
    watching.add(g.code);
    await socket.join(roomOf(g.code));
    ack({ ok: true, state: stateOf(g) });
    broadcast(g); // others see you come online
  });

  socket.on('cb:unwatch', (payload: { code?: string }) => {
    const g = gameFor(payload?.code);
    if (!g) return;
    g.watchers.delete(socket.id);
    watching.delete(g.code);
    socket.leave(roomOf(g.code));
    broadcast(g);
  });

  /** Lobby moves: pick a side, ready up (pays the stake), or take it back. */
  const lobby = (name: string, fn: (g: Game, p: Record<string, unknown>) => Promise<string | null>) =>
    socket.on(name, async (payload: Record<string, unknown>, ackFn: unknown) => {
      const ack = safeAck(ackFn);
      const g = gameFor(payload?.code);
      if (!g) return ack({ error: 'This table has closed' });
      const err = await fn(g, payload ?? {});
      if (games.get(g.code) === g) broadcast(g);
      ack(err ? { error: err } : { ok: true });
    });

  lobby('cb:side', (g, p) => (SIDES.includes(p.side as Side) ? chooseSide(g, userId, p.side as Side) : Promise.resolve('Pick blue or pink')));
  lobby('cb:ready', (g) => ready(g, userId));
  lobby('cb:unready', (g) => unready(g, userId));

  socket.on('cb:reveal', (payload: { code?: string; index?: unknown }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const now = Date.now();
    if (now - lastMove < 150) return ack({ error: 'Slow down a little' });
    lastMove = now;
    const g = gameFor(payload?.code);
    if (!g || g.phase !== 'playing') return ack({ error: 'The game isn’t on' });
    const side = sideOf(g, userId);
    if (!side) return ack({ error: 'You’re not playing in this game' });
    if (g.turn !== side) return ack({ error: 'It’s not your turn' });
    const err = reveal(g, side, payload?.index);
    if (err) return ack({ error: err });
    broadcast(g);
    ack({ ok: true });
  });

  // Sticker reactions float up on both phones.
  socket.on('cb:react', (payload: { code?: string; stickerId?: string }) => {
    const g = gameFor(payload?.code);
    const now = Date.now();
    if (!g || !sideOf(g, userId) || typeof payload?.stickerId !== 'string' || !STICKER_ID.test(payload.stickerId) || now - lastReact < 700) return;
    lastReact = now;
    getIo().to(roomOf(g.code)).emit('cb:react', { code: g.code, userId, stickerId: payload.stickerId });
  });

  // Quick table comments: they float on everyone's screen for a few seconds and aren't kept.
  socket.on('cb:say', async (payload: { code?: string; text?: string }) => {
    const g = gameFor(payload?.code);
    const now = Date.now();
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT) : '';
    if (!g || !text || !watching.has(g.code) || now - lastSay < 1200) return;
    lastSay = now;
    const user = (sideOf(g, userId) ? g.seats[sideOf(g, userId)!]!.user : null) ?? (await getUser(userId).then((u) => (u ? person(u) : null)));
    if (!user) return;
    getIo().to(roomOf(g.code)).emit('cb:say', { code: g.code, id: crypto.randomUUID(), user, text });
  });

  socket.on('disconnect', () => {
    for (const code of watching) {
      const g = games.get(code);
      if (g?.watchers.delete(socket.id)) broadcast(g);
    }
    watching.clear();
  });
}
