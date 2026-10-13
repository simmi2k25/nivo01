import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { grant, pushBalance, spend } from '../coins.js';
import { one, query, tx } from '../db.js';
import { fail } from '../http.js';
import { getUser, postMessage, type PublicUser } from '../model.js';
import { canPlay, COLORS, hasPlayable, isNumber, isWild, newDeck, shuffle, type Card, type Color } from '../uno/rules.js';
import { notifyTogether } from './chill.js';
import { getIo } from './hub.js';

/**
 * UNO engine. The server holds the deck and every hand and checks each move against the rules;
 * phones are sent the table plus their own cards only, so nobody can peek or play out of turn.
 * Bets are taken when you sit down and held in uno_seats until the winner is paid (or refunded).
 */

export const UNO_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'That table code doesn’t look right');

export const MIN_BET = 1;
export const MAX_BET = 100;
export const MAX_PLAYERS = 4;
const HAND_SIZE = 7;
const TURN_MS = 30_000;
/** Extra time on the first turn while phones play the shuffle and deal. */
const INTRO_MS = 5_000;
/** Turns timed out in a row before a player is counted as gone. */
const MAX_MISSED = 3;
const LOBBY_TTL_MS = 30 * 60_000;
const FINISHED_TTL_MS = 10 * 60_000;
const KEEP_EVENTS = 16;
const MAX_COMMENT = 80;
const EMOTES = ['😂', '😮', '😡', '🔥', '👏', '😭', '🥶', '😈'];

type Person = { id: number; displayName: string; avatar: string; avatarUrl: string | null };

type Seat = { userId: number; user: Person; bet: number; hand: Card[]; missed: number; out: boolean; saidUno: boolean };

export type UnoEvent = {
  seq: number;
  type: 'sit' | 'leave' | 'start' | 'play' | 'draw' | 'pass' | 'skip' | 'reverse' | 'penalty' | 'uno' | 'caught' | 'timeout' | 'forfeit' | 'reshuffle' | 'win';
  by?: number;
  target?: number;
  card?: Card;
  count?: number;
  color?: Color;
  amount?: number;
};

type Phase = 'lobby' | 'playing' | 'finished' | 'closed';

type Game = {
  id: number;
  code: string;
  hostId: number;
  conversationId: number | null;
  minBet: number;
  maxBet: number;
  phase: Phase;
  seats: Seat[];
  deck: Card[];
  discard: Card[];
  color: Color;
  /** Index into seats of whoever is playing. */
  turn: number;
  direction: 1 | -1;
  /** The playable card the current player just drew: they may play it or pass. */
  drawnId: string | null;
  /** Someone went down to one card without calling UNO — others can catch them until the next move. */
  unoPending: number | null;
  turnEndsAt: number;
  winnerId: number | null;
  payout: number;
  events: UnoEvent[];
  seq: number;
  /** socket id → user id, for everyone looking at the table (players and onlookers). */
  watchers: Map<string, number>;
  turnTimer: NodeJS.Timeout | null;
  expireTimer: NodeJS.Timeout | null;
  liveTimer: NodeJS.Timeout | null;
};

type TableRow = { id: number; code: string; host_id: number; conversation_id: number | null; min_bet: number; max_bet: number; status: Phase };

const games = new Map<string, Game>();
const roomOf = (code: string) => `uno:${code}`;

const person = (u: PublicUser): Person => ({ id: u.id, displayName: u.displayName, avatar: u.avatar, avatarUrl: u.avatarUrl });
const topOf = (g: Game) => g.discard[g.discard.length - 1];
const activeSeats = (g: Game) => g.seats.filter((s) => !s.out);
const seatOf = (g: Game, userId: number) => g.seats.find((s) => s.userId === userId) ?? null;
const potOf = (g: Game) => g.seats.reduce((n, s) => n + s.bet, 0);
const isWatching = (g: Game, userId: number) => [...g.watchers.values()].includes(userId);

// ---------- state sent to phones ----------

function publicState(g: Game) {
  const playing = g.phase === 'playing';
  return {
    code: g.code,
    hostId: g.hostId,
    conversationId: g.conversationId,
    minBet: g.minBet,
    maxBet: g.maxBet,
    maxPlayers: MAX_PLAYERS,
    phase: g.phase,
    pot: potOf(g),
    players: g.seats.map((s) => ({ user: s.user, bet: s.bet, count: s.hand.length, out: s.out, online: isWatching(g, s.userId) })),
    turnUserId: playing ? g.seats[g.turn]?.userId ?? null : null,
    direction: g.direction,
    color: g.color,
    pile: g.discard.slice(-5),
    deckCount: g.deck.length,
    drewThisTurn: playing && !!g.drawnId,
    unoPending: g.unoPending,
    turnEndsAt: playing ? g.turnEndsAt : null,
    winnerId: g.winnerId,
    payout: g.payout,
    events: g.events,
    serverNow: Date.now(),
  };
}

function stateFor(g: Game, userId: number) {
  const seat = seatOf(g, userId);
  const myTurn = seat && g.phase === 'playing' && g.seats[g.turn] === seat;
  return { ...publicState(g), you: seat ? { hand: seat.hand, drawnId: myTurn ? g.drawnId : null, out: seat.out } : null };
}

/** Each phone gets its own copy: the table plus that player's cards. */
function broadcast(g: Game) {
  const io = getIo();
  for (const [socketId, userId] of g.watchers) io.sockets.sockets.get(socketId)?.emit('uno:state', stateFor(g, userId));
  scheduleLive(g);
}

function push(g: Game, e: Omit<UnoEvent, 'seq'>) {
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
export function liveUnoTables() {
  return [...games.values()]
    .filter((g) => g.phase === 'lobby' || g.phase === 'playing')
    .map((g) => ({
      code: g.code,
      hostId: g.hostId,
      conversationId: g.conversationId,
      phase: g.phase,
      players: g.seats.map((s) => s.user),
      pot: potOf(g),
      minBet: g.minBet,
      maxBet: g.maxBet,
    }));
}

// ---------- coins ----------

/** Gives bets back. `userIds` refunds (and removes) just those seats; null refunds everyone left. */
async function refund(tableId: number, code: string, userIds: number[] | null) {
  const rows = await tx(async (c) => {
    const r = userIds
      ? await c.query<{ user_id: number; bet: number }>(
          'DELETE FROM uno_seats WHERE table_id = $1 AND NOT settled AND user_id = ANY($2::bigint[]) RETURNING user_id, bet',
          [tableId, userIds],
        )
      : await c.query<{ user_id: number; bet: number }>('UPDATE uno_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING user_id, bet', [tableId]);
    for (const row of r.rows) await grant(c, row.user_id, row.bet, 'uno_refund', { code });
    return r.rows;
  });
  for (const row of rows) await pushBalance(row.user_id).catch(() => {});
}

/** After a restart the games are gone: close them and hand every bet back. */
export async function recoverUnoTables() {
  const r = await query<{ id: number; code: string }>(`UPDATE uno_tables SET status = 'closed' WHERE status IN ('lobby','playing') RETURNING id, code`);
  for (const t of r.rows) await refund(t.id, t.code, null).catch((e) => console.error('[uno] refund on restart failed', t.code, e.message));
  if (r.rowCount) console.log(`[uno] closed ${r.rowCount} unfinished table(s) and refunded the bets`);
}

// ---------- lobby ----------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/** Opens a table, seats the host and takes their bet — all or nothing. */
export async function createTable(userId: number, opts: { minBet: number; maxBet: number; bet: number; conversationId: number | null }) {
  const user = await getUser(userId);
  if (!user) throw fail(401, 'Please log in again');
  const row = await tx(async (c) => {
    let t: TableRow | undefined;
    for (let i = 0; i < 5 && !t; i++) {
      const r = await c.query<TableRow>(
        `INSERT INTO uno_tables (code, host_id, conversation_id, min_bet, max_bet) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [newCode(), userId, opts.conversationId, opts.minBet, opts.maxBet],
      );
      t = r.rows[0];
    }
    if (!t) throw fail(500, 'Couldn’t open a table — try again');
    await c.query('INSERT INTO uno_seats (table_id, user_id, bet) VALUES ($1, $2, $3)', [t.id, userId, opts.bet]);
    await spend(c, userId, opts.bet, 'uno_bet', { code: t.code });
    return t;
  });
  await pushBalance(userId);

  const g: Game = {
    id: row.id,
    code: row.code,
    hostId: userId,
    conversationId: row.conversation_id,
    minBet: row.min_bet,
    maxBet: row.max_bet,
    phase: 'lobby',
    seats: [{ userId, user: person(user), bet: opts.bet, hand: [], missed: 0, out: false, saidUno: false }],
    deck: [],
    discard: [],
    color: 'red',
    turn: 0,
    direction: 1,
    drawnId: null,
    unoPending: null,
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
  // Nobody started it in time: close it and give everyone their coins back.
  g.expireTimer = setTimeout(() => g.phase === 'lobby' && closeTable(g, 'The table timed out before the game started'), LOBBY_TTL_MS);
  games.set(g.code, g);
  notifyTogether(userId, g.conversationId);
  return g.code;
}

export async function seatPlayer(code: string, userId: number, bet: number) {
  const g = games.get(code);
  if (!g) throw fail(404, 'This table has closed');
  if (seatOf(g, userId)) return;
  if (g.phase !== 'lobby') throw fail(409, 'This game has already started');
  if (g.seats.length >= MAX_PLAYERS) throw fail(409, 'The table is full');
  if (!Number.isInteger(bet) || bet < g.minBet || bet > g.maxBet) throw fail(400, `Bet between ${g.minBet} and ${g.maxBet} coins`);
  const user = await getUser(userId);
  if (!user) throw fail(401, 'Please log in again');
  await tx(async (c) => {
    const ins = await c.query('INSERT INTO uno_seats (table_id, user_id, bet) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [g.id, userId, bet]);
    if (!ins.rowCount) throw fail(409, 'You’re already at this table');
    await spend(c, userId, bet, 'uno_bet', { code });
  });
  await pushBalance(userId);
  // The game may have started, filled up or closed while the coins moved.
  if (games.get(code) !== g || g.phase !== 'lobby' || g.seats.length >= MAX_PLAYERS) {
    await refund(g.id, code, [userId]);
    throw fail(409, 'The table changed while you were sitting down — your coins are back');
  }
  g.seats.push({ userId, user: person(user), bet, hand: [], missed: 0, out: false, saidUno: false });
  push(g, { type: 'sit', by: userId, amount: bet });
  broadcast(g);
}

/** Leaving the lobby refunds your bet (the host leaving closes the table); leaving a game forfeits it. */
export async function leaveTable(code: string, userId: number) {
  const g = games.get(code);
  const seat = g && seatOf(g, userId);
  if (!g || !seat) return;
  if (g.phase === 'lobby') {
    if (userId === g.hostId) return closeTable(g, 'The host closed the table — bets were refunded');
    g.seats = g.seats.filter((s) => s !== seat);
    push(g, { type: 'leave', by: userId });
    broadcast(g);
    await refund(g.id, code, [userId]);
  } else if (g.phase === 'playing' && !seat.out) {
    forfeit(g, seat);
    broadcast(g);
  }
}

export async function closeTable(g: Game, reason: string) {
  if (g.phase === 'closed' || g.phase === 'finished') return;
  g.phase = 'closed';
  clearTimers(g);
  games.delete(g.code);
  const io = getIo();
  io.to(roomOf(g.code)).emit('uno:closed', { code: g.code, reason });
  io.in(roomOf(g.code)).socketsLeave(roomOf(g.code));
  try {
    await refund(g.id, g.code, null);
    await query(`UPDATE uno_tables SET status = 'closed' WHERE id = $1`, [g.id]);
  } catch (e) {
    console.error('[uno] close refund failed', g.code, (e as Error).message);
  }
  notifyTogether(g.hostId, g.conversationId);
}

export const findGame = (code: string) => games.get(code) ?? null;

export async function tableInfo(code: string) {
  return one<{ code: string; status: Phase; host_id: number; conversation_id: number | null }>('SELECT code, status, host_id, conversation_id FROM uno_tables WHERE code = $1', [code]);
}

// ---------- the game ----------

function nextIndex(g: Game, from: number) {
  const n = g.seats.length;
  let i = from;
  do i = (i + g.direction + n) % n;
  while (g.seats[i].out && i !== from);
  return i;
}

/** The draw pile ran out: everything under the top card is shuffled back in. */
function refill(g: Game) {
  if (g.discard.length <= 1) return;
  const top = g.discard.pop()!;
  g.deck = shuffle(g.discard);
  g.discard = [top];
  push(g, { type: 'reshuffle' });
}

function drawCards(g: Game, seat: Seat, n: number) {
  const got: Card[] = [];
  for (let k = 0; k < n; k++) {
    if (!g.deck.length) refill(g);
    const c = g.deck.pop();
    if (!c) break;
    seat.hand.push(c);
    got.push(c);
  }
  return got;
}

function startTurn(g: Game, index: number, extraMs = 0) {
  g.turn = index;
  g.drawnId = null;
  g.turnEndsAt = Date.now() + TURN_MS + extraMs;
  if (g.turnTimer) clearTimeout(g.turnTimer);
  const seat = g.seats[index];
  const at = g.turnEndsAt;
  g.turnTimer = setTimeout(() => {
    if (g.phase === 'playing' && g.seats[g.turn] === seat && g.turnEndsAt === at) onTimeout(g, seat);
  }, TURN_MS + extraMs);
}

/** Out of time: draw one (unless a drawn card is waiting) and move on. Three in a row and you're out. */
function onTimeout(g: Game, seat: Seat) {
  seat.missed++;
  g.unoPending = null;
  push(g, { type: 'timeout', by: seat.userId });
  if (seat.missed >= MAX_MISSED) {
    forfeit(g, seat);
    return broadcast(g);
  }
  if (!g.drawnId && drawCards(g, seat, 1).length) push(g, { type: 'draw', by: seat.userId, count: 1 });
  seat.saidUno = false;
  startTurn(g, nextIndex(g, g.turn));
  broadcast(g);
}

export function startGame(g: Game) {
  g.phase = 'playing';
  g.deck = newDeck();
  g.discard = [];
  g.direction = 1;
  g.unoPending = null;
  for (const s of g.seats) Object.assign(s, { hand: [], missed: 0, out: false, saidUno: false });
  for (let r = 0; r < HAND_SIZE; r++) for (const s of g.seats) s.hand.push(g.deck.pop()!);
  // The first card is always a number, so nobody is hit by an action before the game starts.
  const first = g.deck.findLastIndex(isNumber);
  const [top] = g.deck.splice(first, 1);
  g.discard.push(top);
  g.color = top.color as Color;
  push(g, { type: 'start', card: top, color: g.color });
  startTurn(g, crypto.randomInt(g.seats.length), INTRO_MS);
  if (g.expireTimer) clearTimeout(g.expireTimer);
  g.expireTimer = null;
  query(`UPDATE uno_tables SET status = 'playing' WHERE id = $1`, [g.id]).catch((e) => console.error('[uno] start save failed', e.message));
  broadcast(g);
}

function forfeit(g: Game, seat: Seat) {
  const wasTurn = g.seats[g.turn] === seat;
  seat.out = true;
  g.deck.unshift(...seat.hand);
  seat.hand = [];
  if (g.unoPending === seat.userId) g.unoPending = null;
  push(g, { type: 'forfeit', by: seat.userId });
  const left = activeSeats(g);
  if (left.length === 1) return finish(g, left[0]);
  if (wasTurn) startTurn(g, nextIndex(g, g.turn));
}

function finish(g: Game, winner: Seat) {
  g.phase = 'finished';
  g.winnerId = winner.userId;
  g.payout = potOf(g);
  g.unoPending = null;
  clearTimers(g);
  push(g, { type: 'win', by: winner.userId, amount: g.payout });
  settle(g, winner).finally(() => broadcast(g));
  setTimeout(() => games.get(g.code) === g && games.delete(g.code), FINISHED_TTL_MS).unref();
}

/** Pays the whole pot to the winner and drops a note in the linked chat. */
async function settle(g: Game, winner: Seat) {
  try {
    const pot = await tx(async (c) => {
      const r = await c.query<{ bet: number }>('UPDATE uno_seats SET settled = true WHERE table_id = $1 AND NOT settled RETURNING bet', [g.id]);
      const total = r.rows.reduce((n, x) => n + x.bet, 0);
      if (total) await grant(c, winner.userId, total, 'uno_win', { code: g.code });
      await c.query(`UPDATE uno_tables SET status = 'finished', winner_id = $2, pot = $3, finished_at = now() WHERE id = $1`, [g.id, winner.userId, total]);
      return total;
    });
    g.payout = pot;
    await Promise.all(g.seats.map((s) => pushBalance(s.userId).catch(() => {})));
    if (g.conversationId) {
      await postMessage({
        conversationId: g.conversationId,
        senderId: null,
        kind: 'system',
        body: `🏆 ${winner.user.displayName} won ${pot} ${pot === 1 ? 'coin' : 'coins'} at NivoTalk Cards`,
        meta: { event: 'uno_win', code: g.code, by: winner.userId, amount: pot },
      });
    }
  } catch (e) {
    console.error('[uno] payout failed', g.code, e);
  }
  notifyTogether(g.hostId, g.conversationId);
}

const COLOR_WORD: Record<Color, string> = { red: 'red', yellow: 'yellow', green: 'green', blue: 'blue' };
const VALUE_WORD: Record<string, string> = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
const valueWord = (c: Card) => VALUE_WORD[c.value] ?? c.value;

function play(g: Game, seat: Seat, cardId: string, chosen: unknown): string | null {
  const i = seat.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return 'That card isn’t in your hand';
  if (g.drawnId && g.drawnId !== cardId) return 'You can only play the card you just drew — or pass';
  const card = seat.hand[i];
  const top = topOf(g);
  if (!canPlay(card, seat.hand, top, g.color)) {
    return card.value === 'wild4' ? 'Wild Draw Four is only allowed when you have no other card to play' : `Play a ${COLOR_WORD[g.color]} card or a ${valueWord(top)}`;
  }
  if (isWild(card) && !COLORS.includes(chosen as Color)) return 'Pick a color for your wild card';

  g.unoPending = null;
  seat.missed = 0;
  seat.hand.splice(i, 1);
  g.discard.push(card);
  g.drawnId = null;
  g.color = isWild(card) ? (chosen as Color) : (card.color as Color);
  push(g, { type: 'play', by: seat.userId, card, color: g.color });

  if (seat.hand.length === 1) {
    if (seat.saidUno) push(g, { type: 'uno', by: seat.userId });
    else g.unoPending = seat.userId;
  }
  seat.saidUno = false;
  if (seat.hand.length === 0) {
    finish(g, seat);
    return null;
  }

  const me = g.turn;
  let next = nextIndex(g, me);
  const hit = (n: number) => {
    const target = g.seats[next];
    drawCards(g, target, n);
    push(g, { type: 'penalty', by: seat.userId, target: target.userId, count: n });
    next = nextIndex(g, next);
  };
  switch (card.value) {
    case 'skip':
      push(g, { type: 'skip', by: seat.userId, target: g.seats[next].userId });
      next = nextIndex(g, next);
      break;
    case 'reverse':
      g.direction = g.direction === 1 ? -1 : 1;
      push(g, { type: 'reverse', by: seat.userId });
      // With two players a reverse works like a skip.
      next = activeSeats(g).length === 2 ? me : nextIndex(g, me);
      break;
    case 'draw2':
      hit(2);
      break;
    case 'wild4':
      hit(4);
      break;
  }
  startTurn(g, next);
  return null;
}

function draw(g: Game, seat: Seat): string | null {
  if (g.drawnId) return 'Play the card you drew, or pass';
  if (hasPlayable(seat.hand, topOf(g), g.color)) return 'You have a card you can play';
  g.unoPending = null;
  seat.missed = 0;
  seat.saidUno = false;
  const [c] = drawCards(g, seat, 1);
  push(g, { type: 'draw', by: seat.userId, count: c ? 1 : 0 });
  if (c && canPlay(c, seat.hand, topOf(g), g.color)) g.drawnId = c.id;
  else startTurn(g, nextIndex(g, g.turn));
  return null;
}

function pass(g: Game, seat: Seat): string | null {
  if (!g.drawnId) return 'Draw a card first';
  seat.missed = 0;
  push(g, { type: 'pass', by: seat.userId });
  startTurn(g, nextIndex(g, g.turn));
  return null;
}

function sayUno(g: Game, seat: Seat): string | null {
  if (g.unoPending === seat.userId && seat.hand.length === 1) {
    g.unoPending = null;
    push(g, { type: 'uno', by: seat.userId });
    return null;
  }
  const myTurn = g.seats[g.turn] === seat;
  if (myTurn && seat.hand.length === 2 && !seat.saidUno && hasPlayable(seat.hand, topOf(g), g.color)) {
    seat.saidUno = true;
    push(g, { type: 'uno', by: seat.userId });
    return null;
  }
  return 'Call “last card” when you’re about to play your second-last card';
}

function catchUno(g: Game, seat: Seat): string | null {
  const caught = g.unoPending != null ? seatOf(g, g.unoPending) : null;
  if (!caught || caught === seat || caught.out || caught.hand.length !== 1) return 'Too late — nobody to catch';
  drawCards(g, caught, 2);
  g.unoPending = null;
  push(g, { type: 'caught', by: seat.userId, target: caught.userId, count: 2 });
  return null;
}

// ---------- socket API ----------

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachUno(socket: Socket) {
  const userId: number = socket.data.userId;
  const watching = new Set<string>();
  let lastMove = 0;
  let lastEmote = 0;
  let lastSay = 0;

  const gameFor = (raw: unknown) => {
    const parsed = UNO_CODE.safeParse(raw);
    return parsed.success ? (games.get(parsed.data) ?? null) : null;
  };

  socket.on('uno:join', async (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const parsed = UNO_CODE.safeParse(payload?.code);
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
    broadcast(g); // others see you come online
  });

  socket.on('uno:unwatch', (payload: { code?: string }) => {
    const g = gameFor(payload?.code);
    if (!g) return;
    g.watchers.delete(socket.id);
    watching.delete(g.code);
    socket.leave(roomOf(g.code));
    broadcast(g);
  });

  socket.on('uno:start', (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const g = gameFor(payload?.code);
    if (!g) return ack({ error: 'This table has closed' });
    if (g.hostId !== userId) return ack({ error: 'Only the host can start the game' });
    if (g.phase !== 'lobby') return ack({ error: 'The game has already started' });
    if (g.seats.length < 2) return ack({ error: 'You need at least 2 players' });
    startGame(g);
    ack({ ok: true });
  });

  /** Every move goes through here: the server re-checks turn, card and rules before anything changes. */
  const move = (name: string, fn: (g: Game, seat: Seat, p: Record<string, unknown>) => string | null) =>
    socket.on(name, (payload: Record<string, unknown>, ackFn: unknown) => {
      const ack = safeAck(ackFn);
      const now = Date.now();
      if (now - lastMove < 150) return ack({ error: 'Slow down a little' });
      lastMove = now;
      const g = gameFor(payload?.code);
      if (!g || g.phase !== 'playing') return ack({ error: 'The game isn’t on' });
      const seat = seatOf(g, userId);
      if (!seat || seat.out) return ack({ error: 'You’re not playing in this game' });
      const anytime = name === 'uno:uno' || name === 'uno:catch';
      if (!anytime && g.seats[g.turn] !== seat) return ack({ error: 'It’s not your turn' });
      const err = fn(g, seat, payload ?? {});
      if (err) return ack({ error: err });
      broadcast(g);
      ack({ ok: true });
    });

  move('uno:play', (g, seat, p) => (typeof p.cardId === 'string' ? play(g, seat, p.cardId, p.color) : 'Pick a card'));
  move('uno:draw', (g, seat) => draw(g, seat));
  move('uno:pass', (g, seat) => pass(g, seat));
  move('uno:uno', (g, seat) => sayUno(g, seat));
  move('uno:catch', (g, seat) => catchUno(g, seat));

  socket.on('uno:emote', (payload: { code?: string; emoji?: string }) => {
    const g = gameFor(payload?.code);
    const now = Date.now();
    if (!g || !seatOf(g, userId) || !EMOTES.includes(String(payload?.emoji)) || now - lastEmote < 800) return;
    lastEmote = now;
    getIo().to(roomOf(g.code)).emit('uno:emote', { code: g.code, userId, emoji: payload.emoji });
  });

  // Quick table comments: they float on everyone's screen for a few seconds and aren't kept.
  socket.on('uno:say', async (payload: { code?: string; text?: string }) => {
    const g = gameFor(payload?.code);
    const now = Date.now();
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT) : '';
    if (!g || !text || !watching.has(g.code) || now - lastSay < 1200) return;
    lastSay = now;
    const user = seatOf(g, userId)?.user ?? (await getUser(userId).then((u) => (u ? person(u) : null)));
    if (!user) return;
    getIo().to(roomOf(g.code)).emit('uno:say', { code: g.code, id: crypto.randomUUID(), user, text });
  });

  socket.on('disconnect', () => {
    for (const code of watching) {
      const g = games.get(code);
      if (g?.watchers.delete(socket.id)) broadcast(g);
    }
    watching.clear();
  });
}
