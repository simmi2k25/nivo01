// End-to-end UNO test: three players bet, play a full game with legal moves, and the pot is paid out.
// Usage (against a running server): node tools/uno-smoke.mjs [baseUrl]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const rnd = Math.random().toString(36).slice(2, 7);
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(BASE + '/api' + path, {
      method,
      headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  return { call, get cookie() { return cookie; } };
}

const players = [];
for (const name of ['ana', 'bo', 'cy']) {
  const c = client();
  const username = `${name}_${rnd}`;
  const r = await c.call('POST', '/auth/register', { username, email: `${username}@x.io`, password: 'password123' });
  check(r.status === 201, `register ${name}`);
  const me = (await c.call('GET', '/auth/me')).data.user;
  await c.call('POST', '/coins/buy', { packId: 'c100' }); // test-mode top-up so everyone can bet
  const sock = io(BASE, { extraHeaders: { cookie: c.cookie }, transports: ['websocket'] });
  await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });
  players.push({ name, c, me, sock, state: null });
}
const [A, B, C] = players;
const coins = async (p) => (await p.c.call('GET', '/coins')).data.coins;
const start = Object.fromEntries(await Promise.all(players.map(async (p) => [p.name, await coins(p)])));
check(start.ana > 20, `players start with coins (${start.ana})`);

const emit = (p, ev, payload = {}) => new Promise((res) => p.sock.timeout(5000).emit(ev, { code, ...payload }, (err, r) => res(err ? { error: 'timeout' } : r)));

// ---------- lobby & bets ----------
check((await A.c.call('POST', '/uno', { minBet: 5, maxBet: 20, bet: 25 })).status === 400, 'host bet outside own range rejected');
check((await A.c.call('POST', '/uno', { minBet: 0, maxBet: 20, bet: 5 })).status === 400, 'range below 1 rejected');
check((await A.c.call('POST', '/uno', { minBet: 5, maxBet: 101, bet: 5 })).status === 400, 'range above 100 rejected');
const created = await A.c.call('POST', '/uno', { minBet: 5, maxBet: 20, bet: 10 });
check(created.status === 201, 'host opens a table');
var code = created.data.code;
check((await coins(A)) === start.ana - 10, 'host bet taken');

for (const p of players) {
  p.sock.on('uno:state', (s) => (p.state = s));
  const r = await emit(p, 'uno:join');
  check(r.ok, `${p.name} joins the table`);
  p.state = r.state;
}
check((await B.c.call('POST', `/uno/${code}/sit`, { bet: 50 })).status === 400, 'bet above table max rejected');
check((await B.c.call('POST', `/uno/${code}/sit`, { bet: 4 })).status === 400, 'bet below table min rejected');
check((await B.c.call('POST', `/uno/${code}/sit`, { bet: 20 })).status === 200, 'bo sits with 20');
check((await coins(B)) === start.bo - 20, 'bo bet taken');
await B.c.call('POST', `/uno/${code}/leave`);
check((await coins(B)) === start.bo, 'leaving the lobby refunds');
check((await B.c.call('POST', `/uno/${code}/sit`, { bet: 15 })).status === 200, 'bo sits again with 15');
check((await C.c.call('POST', `/uno/${code}/sit`, { bet: 5 })).status === 200, 'cy sits with 5');
check((await emit(B, 'uno:start')).error?.includes('host'), 'only the host can start');
await wait(300);
check(A.state.pot === 30 && A.state.players.length === 3, 'pot is 30 with 3 players');
check((await emit(A, 'uno:start')).ok, 'host deals');
await wait(300);

// ---------- the game ----------
const s0 = A.state;
check(s0.phase === 'playing', 'game is on');
check(players.every((p) => p.state.you.hand.length === 7), 'everyone has 7 cards');
check(s0.players.every((p) => p.count === 7) && !('hand' in s0.players[0]), 'others only see card counts');
check(/^[0-9]$/.test(s0.pile.at(-1).value), 'first card is a number');
check(s0.deckCount === 108 - 21 - 1, 'deck has the rest of 108 cards');

const isWild = (c) => c.value === 'wild' || c.value === 'wild4';
const matches = (c, top, color) => isWild(c) || c.color === color || c.value === top.value;
const canPlay = (c, hand, top, color) => matches(c, top, color) && (c.value !== 'wild4' || !hand.some((x) => x.value !== 'wild4' && matches(x, top, color)));

const turnOf = () => players.find((p) => p.me.id === A.state.turnUserId);
{
  const p = turnOf();
  const other = players.find((x) => x !== p);
  const r = await emit(other, 'uno:play', { cardId: other.state.you.hand[0].id, color: 'red' });
  check(r.error === 'It’s not your turn', 'playing out of turn is refused');
  const { hand } = p.state.you;
  const top = p.state.pile.at(-1);
  const bad = hand.find((c) => !canPlay(c, hand, top, p.state.color));
  await wait(200);
  if (bad) check(!!(await emit(p, 'uno:play', { cardId: bad.id, color: 'red' })).error, `illegal card refused (${bad.color} ${bad.value} on ${top.color} ${top.value})`);
  await wait(200);
  if (hand.some((c) => canPlay(c, hand, top, p.state.color))) check((await emit(p, 'uno:draw')).error?.includes('can play'), 'drawing while holding a playable card is refused');
  await wait(200);
  check(!!(await emit(p, 'uno:play', { cardId: 'not-mine' })).error, 'unknown card refused');
  await wait(200);
}

let moves = 0;
let caught = 0;
let unos = 0;
while (A.state.phase === 'playing' && moves < 600) {
  await wait(170);
  for (const p of players) {
    if (A.state.unoPending && A.state.unoPending !== p.me.id && moves % 2 === 0) {
      if ((await emit(p, 'uno:catch')).ok) caught++;
      await wait(170);
    }
  }
  const p = turnOf();
  if (!p || p.state.turnUserId !== p.me.id) continue;
  const { hand, drawnId } = p.state.you;
  const top = p.state.pile.at(-1);
  const color = p.state.color;
  const favourite = ['red', 'yellow', 'green', 'blue'].sort((a, b) => hand.filter((c) => c.color === b).length - hand.filter((c) => c.color === a).length)[0];
  let r;
  if (drawnId) {
    r = await emit(p, 'uno:play', { cardId: drawnId, color: favourite });
  } else {
    const card = hand.find((c) => canPlay(c, hand, top, color));
    if (card) {
      if (hand.length === 2 && moves % 3) {
        if ((await emit(p, 'uno:uno')).ok) unos++;
        await wait(170);
      }
      r = await emit(p, 'uno:play', { cardId: card.id, color: favourite });
    } else r = await emit(p, 'uno:draw');
  }
  if (r.error) {
    console.log('  move refused:', r.error);
    failures++;
    break;
  }
  moves++;
}
await wait(800);
const end = A.state;
check(end.phase === 'finished', `game finished after ${moves} moves (${unos} UNO calls, ${caught} catches)`);
const winner = players.find((p) => p.me.id === end.winnerId);
check(!!winner && winner.state.you.hand.length === 0, `${winner?.name} won with an empty hand`);
check(end.payout === 30, 'payout is the whole pot');
const after = Object.fromEntries(await Promise.all(players.map(async (p) => [p.name, await coins(p)])));
const bets = { ana: 10, bo: 15, cy: 5 };
for (const p of players) {
  const expected = start[p.name] - bets[p.name] + (p === winner ? 30 : 0);
  check(after[p.name] === expected, `${p.name} balance ${start[p.name]} → ${after[p.name]} (expected ${expected})`);
}
const hist = (await winner.c.call('GET', '/coins')).data.history;
check(hist.some((h) => h.reason === 'uno_win' && h.delta === 30), 'winnings in coin history');

// ---------- host closing a lobby refunds everyone ----------
const t2 = (await B.c.call('POST', '/uno', { minBet: 1, maxBet: 100, bet: 7 })).data.code;
check((await C.c.call('POST', `/uno/${t2}/sit`, { bet: 3 })).status === 200, 'cy sits at a second table');
const beforeClose = { bo: await coins(B), cy: await coins(C) };
await B.c.call('POST', `/uno/${t2}/leave`);
await wait(300);
check((await coins(B)) === beforeClose.bo + 7 && (await coins(C)) === beforeClose.cy + 3, 'host closing the lobby refunds everyone');

players.forEach((p) => p.sock.close());
console.log(failures ? `\n${failures} check(s) failed` : '\nall UNO checks passed');
process.exit(failures ? 1 : 0);
