import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { grant, pushBalance, spend } from '../coins.js';
import { one, query, tx } from '../db.js';
import { fail } from '../http.js';
import { getUser, postMessage, type PublicUser } from '../model.js';
import { notifyTogether } from './chill.js';
import { getIo } from './hub.js';
import { registerVoiceGame } from './voice.js';

/**
 * Guess the Number. Every player hides a number; each one cracks the next player's (two players crack
 * each other's). The server keeps the secrets and answers every guess — too low, too high, correct — so
 * nobody can fib. Fewest tries wins the pot; on a tie, whoever cracked it first. Nobody cracks it in time?
 * Everyone gets their stake back.
 */

export const GN_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'That table code doesn’t look right');

export const MIN_STAKE = 1;
export const MAX_STAKE = 100;
export const RANGES = [50, 100, 1000] as const;
export const MAX_PLAYERS = 4;
const GAME_MS = 3 * 60_000;
/** A moment for phones to show "Go!" before the clock starts. */
const INTRO_MS = 3_000;
const LOBBY_TTL_MS = 30 * 60_000;
const FINISHED_TTL_MS = 10 * 60_000;
const KEEP_EVENTS = 20;
const MAX_COMMENT = 80;

type Person = { id: number; displayName: string; avatar: string; avatarUrl: string | null };
type Hint = 'low' | 'high' | 'correct';
type Guess = { value: number; hint: Hint; at: number };

type Seat = {
  userId: number;
  user: Person;
  secret: number | null;
  /** Stake taken: the coins sit in gn_seats until someone wins (or it's refunded). */
  ready: boolean;
  guesses: Guess[];
  solvedAt: number | null;
  out: boolean;
};

export type GnEvent = { seq: number; type: 'guess' | 'solved' | 'forfeit' | 'win' | 'draw' | 'start'; by?: number; target?: number; value?: number; hint?: Hint; amount?: number };

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

type Game = {
  id: number;
  code: string;
  hostId: number;
  conversationId: number | null;
  stake: number;
  max: number;
  phase: Phase;
  seats: Seat[];
  paying: Set<number>;
  startsAt: number;
  endsAt: number;
  winnerId: number | null;
  payout: number;
  events: GnEvent[];
  seq: number;
  watchers: Map<string, number>;
  endTimer: NodeJS.Timeout | null;
  expireTimer: NodeJS.Timeout | null;
  liveTimer: NodeJS.Timeout | null;
};

type TableRow = { id: number; code: string; host_id: number; conversation_id: number | null; stake: number; max_number: number; status: Phase };

const games = new Map<string, Game>();
const roomOf = (code: string) => `gn:${code}`;
const person = (u: PublicUser): Person => ({ id: u.id, displayName: u.displayName, avatar: u.avatar, avatarUrl: u.avatarUrl });
const seatOf = (g: Game, userId: number) => g.seats.find((s) => s.userId === userId) ?? null;
const potOf = (g: Game) => g.seats.filter((s) => s.ready).length * g.stake;
const isWatching = (g: Game, userId: number) => [...g.watchers.values()].includes(userId);
/** Whose number this seat is cracking: the next player round the table. */
const targetOf = (g: Game, s: Seat) => g.seats[(g.seats.indexOf(s) + 1) % g.seats.length];
const hunterOf = (g: Game, s: Seat) => g.seats[(g.seats.indexOf(s) - 1 + g.seats.length) % g.seats.length];

// ---------- state sent to phones: your own secret and guesses, everyone else's progress only ----------

function stateFor(g: Game, userId: number) {
  const me = seatOf(g, userId);
  const playing = g.phase !== 'lobby';
  const done = g.phase === 'finished';
  return {
    code: g.code,
    hostId: g.hostId,
    conversationId: g.conversationId,
    stake: g.stake,
    max: g.max,
    maxPlayers: MAX_PLAYERS,
    phase: g.phase,
    pot: potOf(g),
    // Kept after the end too, so the results can show how long each player took.
    startsAt: g.phase !== 'lobby' ? g.startsAt : null,
    endsAt: g.phase === 'playing' ? g.endsAt : null,
    players: g.seats.map((s) => ({
      user: s.user,
      ready: s.ready,
      online: isWatching(g, s.userId),
      out: s.out,
      attempts: s.guesses.length,
      solvedAt: s.solvedAt,
      targetId: playing && g.seats.length > 1 ? targetOf(g, s).userId : null,
      // Once it's over, everyone's number comes out.
      secret: done ? s.secret : null,
    })),
    winnerId: g.winnerId,
    payout: g.payout,
    events: g.events,
    you: me
      ? {
          secret: me.secret,
          guesses: me.guesses,
          // How the person hunting your number is doing — it's your number, so you get to watch.
          onMine: playing && g.seats.length > 1 ? hunterOf(g, me).guesses : [],
        }
      : null,
    serverNow: Date.now(),
  };
}

function broadcast(g: Game) {
  const io = getIo();
  for (const [socketId, userId] of g.watchers) io.sockets.sockets.get(socketId)?.emit('gn:state', stateFor(g, userId));
  scheduleLive(g);
}

function push(g: Game, e: Omit<GnEvent, 'seq'>) {
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
  for (const t of [g.endTimer, g.expireTimer, g.liveTimer]) if (t) clearTimeout(t);
  g.endTimer = g.expireTimer = g.liveTimer = null;
}

/** Tables friends can see on the Together tab. */
export function liveGuessTables() {
  return [...games.values()]
    .filter((g) => g.phase === 'lobby' || g.phase === 'playing')
    .map((g) => ({ code: g.code, hostId: g.hostId, conversationId: g.conversationId, phase: g.phase, players: g.seats.map((s) => s.user), stake: g.stake, max: g.max, pot: potOf(g) }));
}

// ---------- coins ----------

async function refund(tableId: number, code: string, userIds: number[] | null) {
  const rows = await tx(async (c) => {
    const r = userIds
      ? await c.query<{ user_id: number; bet: number }>(
          'DELETE FROM gn_seats WHERE table_id = $1 AND NOT settled AND user_id = ANY($2::bigint[]) RETURNING user_id, bet',
          [tableId, userIds],
        )
      : await c.query<{ user_id: number; bet: number }>('UPDATE gn_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING user_id, bet', [tableId]);
    for (const row of r.rows) await grant(c, row.user_id, row.bet, 'gn_refund', { code });
    return r.rows;
  });
  for (const row of rows) await pushBalance(row.user_id).catch(() => {});
}

/** After a restart the games are gone: close them and hand every stake back. */
export async function recoverGuessTables() {
  const r = await query<{ id: number; code: string }>(`UPDATE gn_tables SET status = 'closed' WHERE status IN ('lobby','playing') RETURNING id, code`);
  for (const t of r.rows) await refund(t.id, t.code, null).catch((e) => console.error('[guess] refund on restart failed', t.code, e.message));
  if (r.rowCount) console.log(`[guess] closed ${r.rowCount} unfinished table(s) and refunded the stakes`);
}

// ---------- lobby ----------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const newSeat = (user: Person): Seat => ({ userId: user.id, user, secret: null, ready: false, guesses: [], solvedAt: null, out: false });

export async function createTable(userId: number, opts: { stake: number; max: number; conversationId: number | null }) {
  const user = await getUser(userId);
  if (!user) throw fail(401, 'Please log in again');
  let row: TableRow | undefined;
  for (let i = 0; i < 5 && !row; i++) {
    row = await one<TableRow>(
      `INSERT INTO gn_tables (code, host_id, conversation_id, stake, max_number) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [newCode(), userId, opts.conversationId, opts.stake, opts.max],
    );
  }
  if (!row) throw fail(500, 'Couldn’t open a table — try again');
  const g: Game = {
    id: row.id,
    code: row.code,
    hostId: userId,
    conversationId: row.conversation_id,
    stake: row.stake,
    max: row.max_number,
    phase: 'lobby',
    seats: [newSeat(person(user))],
    paying: new Set(),
    startsAt: 0,
    endsAt: 0,
    winnerId: null,
    payout: 0,
    events: [],
    seq: 0,
    watchers: new Map(),
    endTimer: null,
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
registerVoiceGame('gn', (code, userId) => {
  const g = games.get(code);
  return !!g && g.phase !== 'closed' && !!seatOf(g, userId);
});

export async function tableInfo(code: string) {
  return one<{ code: string; status: Phase; stake: number }>('SELECT code, status, stake FROM gn_tables WHERE code = $1', [code]);
}

async function sit(g: Game, userId: number): Promise<string | null> {
  if (g.phase !== 'lobby') return 'The game has already started';
  if (seatOf(g, userId)) return null;
  if (g.seats.length >= MAX_PLAYERS) return 'The table is full';
  const user = await getUser(userId);
  if (!user) return 'Please log in again';
  if (seatOf(g, userId) || g.seats.length >= MAX_PLAYERS) return 'That seat was just taken';
  g.seats.push(newSeat(person(user)));
  return null;
}

function setSecret(g: Game, userId: number, value: unknown): string | null {
  const seat = seatOf(g, userId);
  if (g.phase !== 'lobby' || !seat) return 'You can only pick your number before the game starts';
  if (seat.ready || g.paying.has(userId)) return 'Tap “Not ready” to change your number';
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > g.max) return `Pick a whole number from 1 to ${g.max}`;
  seat.secret = value as number;
  return null;
}

async function ready(g: Game, userId: number): Promise<string | null> {
  const seat = seatOf(g, userId);
  if (g.phase !== 'lobby') return 'The game has already started';
  if (!seat) return 'Take a seat first';
  if (seat.secret == null) return 'Pick your secret number first';
  if (seat.ready || g.paying.has(userId)) return null;
  g.paying.add(userId);
  try {
    await tx(async (c) => {
      const ins = await c.query('INSERT INTO gn_seats (table_id, user_id, bet) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [g.id, userId, g.stake]);
      if (!ins.rowCount) throw fail(409, 'You’re already in this game');
      await spend(c, userId, g.stake, 'gn_bet', { code: g.code });
    });
  } catch (e) {
    return (e as Error).message || 'Couldn’t take your stake';
  } finally {
    g.paying.delete(userId);
  }
  await pushBalance(userId).catch(() => {});
  if (games.get(g.code) !== g || g.phase !== 'lobby' || !g.seats.includes(seat)) {
    await refund(g.id, g.code, [userId]);
    return 'The table changed while you were getting ready — your coins are back';
  }
  seat.ready = true;
  return null;
}

async function unready(g: Game, userId: number): Promise<string | null> {
  const seat = seatOf(g, userId);
  if (g.phase !== 'lobby' || !seat?.ready) return null;
  seat.ready = false;
  await refund(g.id, g.code, [userId]);
  return null;
}

function start(g: Game, userId: number): string | null {
  if (g.hostId !== userId) return 'Only the host can start the game';
  if (g.phase !== 'lobby') return 'The game has already started';
  if (g.seats.length < 2) return 'You need at least 2 players';
  const waiting = g.seats.find((s) => !s.ready);
  if (waiting) return `${waiting.user.displayName} isn’t ready yet`;
  g.phase = 'playing';
  g.startsAt = Date.now() + INTRO_MS;
  g.endsAt = g.startsAt + GAME_MS;
  push(g, { type: 'start' });
  if (g.expireTimer) clearTimeout(g.expireTimer);
  g.expireTimer = null;
  g.endTimer = setTimeout(() => g.phase === 'playing' && finish(g), g.endsAt - Date.now());
  query(`UPDATE gn_tables SET status = 'playing' WHERE id = $1`, [g.id]).catch((e) => console.error('[guess] start save failed', e.message));
  return null;
}

/** Leaving the lobby refunds your stake (the host leaving closes the table); leaving a game forfeits it. */
export async function leaveTable(code: string, userId: number) {
  const g = games.get(code);
  const seat = g && seatOf(g, userId);
  if (!g || !seat) return;
  if (g.phase === 'lobby') {
    if (userId === g.hostId) return closeTable(g, 'The host closed the table — stakes were refunded');
    g.seats = g.seats.filter((s) => s !== seat);
    broadcast(g);
    if (seat.ready) await refund(g.id, code, [userId]);
  } else if (g.phase === 'playing' && !seat.out && !seat.solvedAt) {
    seat.out = true;
    push(g, { type: 'forfeit', by: userId });
    checkDone(g);
    broadcast(g);
  }
}

export async function closeTable(g: Game, reason: string) {
  if (g.phase === 'closed' || g.phase === 'finished') return;
  g.phase = 'closed';
  clearTimers(g);
  games.delete(g.code);
  const io = getIo();
  io.to(roomOf(g.code)).emit('gn:closed', { code: g.code, reason });
  io.in(roomOf(g.code)).socketsLeave(roomOf(g.code));
  try {
    await refund(g.id, g.code, null);
    await query(`UPDATE gn_tables SET status = 'closed' WHERE id = $1`, [g.id]);
  } catch (e) {
    console.error('[guess] close refund failed', g.code, (e as Error).message);
  }
  notifyTogether(g.hostId, g.conversationId);
}

// ---------- the game ----------

function guess(g: Game, userId: number, value: unknown): string | null {
  const seat = seatOf(g, userId);
  if (!seat) return 'You’re not playing in this game';
  if (seat.out) return 'You left this game';
  if (seat.solvedAt) return 'You’ve already cracked it';
  if (Date.now() < g.startsAt) return 'Get ready…';
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > g.max) return `Guess a whole number from 1 to ${g.max}`;
  const target = targetOf(g, seat);
  const v = value as number;
  const hint: Hint = v === target.secret ? 'correct' : v < target.secret! ? 'low' : 'high';
  seat.guesses.push({ value: v, hint, at: Date.now() });
  push(g, { type: 'guess', by: userId, target: target.userId, value: v, hint });
  if (hint === 'correct') {
    seat.solvedAt = Date.now();
    push(g, { type: 'solved', by: userId, target: target.userId, amount: seat.guesses.length });
    checkDone(g);
  }
  return null;
}

/** Over once everyone still playing has cracked their number (or only one player is left). */
function checkDone(g: Game) {
  if (g.phase !== 'playing') return;
  const playing = g.seats.filter((s) => !s.out);
  if (playing.length <= 1 || playing.every((s) => s.solvedAt)) finish(g);
}

/** Fewest tries wins; a tie goes to whoever cracked it first. Everyone else left the table? Last one standing. */
function ranking(g: Game) {
  return [...g.seats].sort((a, b) => {
    const sa = a.solvedAt ? 0 : a.out ? 2 : 1;
    const sb = b.solvedAt ? 0 : b.out ? 2 : 1;
    if (sa !== sb) return sa - sb;
    if (a.solvedAt && b.solvedAt) return a.guesses.length - b.guesses.length || a.solvedAt - b.solvedAt;
    return 0;
  });
}

function finish(g: Game) {
  g.phase = 'finished';
  clearTimers(g);
  const [best] = ranking(g);
  const stillIn = g.seats.filter((s) => !s.out);
  const winner = best?.solvedAt ? best : stillIn.length === 1 ? stillIn[0] : null;
  g.winnerId = winner?.userId ?? null;
  g.payout = winner ? potOf(g) : 0;
  push(g, winner ? { type: 'win', by: winner.userId, amount: g.payout } : { type: 'draw' });
  settle(g, winner).finally(() => broadcast(g));
  setTimeout(() => games.get(g.code) === g && games.delete(g.code), FINISHED_TTL_MS).unref();
}

async function settle(g: Game, winner: Seat | null) {
  try {
    if (!winner) {
      // Nobody cracked a number in time: it's a draw and every stake goes home.
      await refund(g.id, g.code, null);
      await query(`UPDATE gn_tables SET status = 'finished', finished_at = now() WHERE id = $1`, [g.id]);
    } else {
      const pot = await tx(async (c) => {
        const r = await c.query<{ bet: number }>('UPDATE gn_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING bet', [g.id]);
        const total = r.rows.reduce((n, x) => n + x.bet, 0);
        if (total) await grant(c, winner.userId, total, 'gn_win', { code: g.code });
        await c.query(`UPDATE gn_tables SET status = 'finished', winner_id = $2, pot = $3, finished_at = now() WHERE id = $1`, [g.id, winner.userId, total]);
        return total;
      });
      g.payout = pot;
      await Promise.all(g.seats.map((s) => pushBalance(s.userId).catch(() => {})));
      if (g.conversationId) {
        const tries = winner.guesses.length;
        await postMessage({
          conversationId: g.conversationId,
          senderId: null,
          kind: 'system',
          body: `🏆 ${winner.user.displayName} cracked the number in ${tries} ${tries === 1 ? 'try' : 'tries'} and won ${pot} ${pot === 1 ? 'coin' : 'coins'}`,
          meta: { event: 'guess_win', code: g.code, by: winner.userId, amount: pot },
        });
      }
    }
  } catch (e) {
    console.error('[guess] payout failed', g.code, e);
  }
  notifyTogether(g.hostId, g.conversationId);
}

// ---------- socket API ----------

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachGuess(socket: Socket) {
  const userId: number = socket.data.userId;
  const watching = new Set<string>();
  let lastGuess = 0;
  let lastSay = 0;

  const gameFor = (raw: unknown) => {
    const parsed = GN_CODE.safeParse(raw);
    return parsed.success ? (games.get(parsed.data) ?? null) : null;
  };

  socket.on('gn:join', async (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const parsed = GN_CODE.safeParse(payload?.code);
    if (!parsed.success) return ack({ error: 'That table code doesn’t look right' });
    const g = games.get(parsed.data);
    if (!g) {
      const row = await tableInfo(parsed.data).catch(() => undefined);
      return ack({ error: row?.status === 'finished' ? 'This game has ended' : 'This table has closed', closed: true });
    }
    g.watchers.set(socket.id, userId);
    watching.add(g.code);
    await socket.join(roomOf(g.code));
    ack({ ok: true, state: stateFor(g, userId) });
    broadcast(g);
  });

  socket.on('gn:unwatch', (payload: { code?: string }) => {
    const g = gameFor(payload?.code);
    if (!g) return;
    g.watchers.delete(socket.id);
    watching.delete(g.code);
    socket.leave(roomOf(g.code));
    broadcast(g);
  });

  /** Every move: run it, send everyone the new table, answer the phone that asked. */
  const move = (name: string, fn: (g: Game, p: Record<string, unknown>) => string | null | Promise<string | null>) =>
    socket.on(name, async (payload: Record<string, unknown>, ackFn: unknown) => {
      const ack = safeAck(ackFn);
      const g = gameFor(payload?.code);
      if (!g) return ack({ error: 'This table has closed' });
      const err = await fn(g, payload ?? {});
      if (games.get(g.code) === g) broadcast(g);
      ack(err ? { error: err } : { ok: true });
    });

  move('gn:sit', (g) => sit(g, userId));
  move('gn:secret', (g, p) => setSecret(g, userId, p.value));
  move('gn:ready', (g) => ready(g, userId));
  move('gn:unready', (g) => unready(g, userId));
  move('gn:start', (g) => start(g, userId));
  move('gn:guess', (g, p) => {
    const now = Date.now();
    if (now - lastGuess < 250) return 'Slow down a little';
    lastGuess = now;
    if (g.phase !== 'playing') return 'The game isn’t on';
    return guess(g, userId, p.value);
  });

  // Quick table comments: they float on everyone's screen for a few seconds and aren't kept.
  socket.on('gn:say', async (payload: { code?: string; text?: string }) => {
    const g = gameFor(payload?.code);
    const now = Date.now();
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT) : '';
    if (!g || !text || !watching.has(g.code) || now - lastSay < 1200) return;
    lastSay = now;
    const user = seatOf(g, userId)?.user ?? (await getUser(userId).then((u) => (u ? person(u) : null)));
    if (!user) return;
    getIo().to(roomOf(g.code)).emit('gn:say', { code: g.code, id: crypto.randomUUID(), user, text });
  });

  socket.on('disconnect', () => {
    for (const code of watching) {
      const g = games.get(code);
      if (g?.watchers.delete(socket.id)) broadcast(g);
    }
    watching.clear();
  });
}
