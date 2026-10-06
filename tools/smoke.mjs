// End-to-end smoke test against a running server: node tools/smoke.mjs [baseUrl]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const rnd = Math.random().toString(36).slice(2, 7);
let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

function client() {
  let cookie = '';
  const call = async (method, path, body, raw) => {
    const r = await fetch(BASE + '/api' + path, {
      method,
      headers: { cookie, ...(raw ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, data };
  };
  return { call, get cookie() { return cookie; } };
}

const a = client();
const b = client();
const ua = `amy_${rnd}`;
const ub = `ben_${rnd}`;

check((await a.call('GET', `/auth/check-username?username=${ua}`)).data.available === true, 'username available');
check((await a.call('POST', '/auth/register', { username: ua, email: `${ua}@x.io`, password: 'password123', avatar: 'berri' })).status === 201, 'register A');
check((await b.call('POST', '/auth/register', { username: ub, email: `${ub}@x.io`, password: 'password123' })).status === 201, 'register B');
check((await a.call('POST', '/auth/register', { username: ua, email: `z${ua}@x.io`, password: 'password123' })).status === 409, 'duplicate username rejected');
check((await b.call('POST', '/auth/login', { identifier: `${ub}@x.io`, password: 'password123' })).status === 200, 'login by email');
check((await b.call('POST', '/auth/login', { identifier: ub, password: 'nope-nope' })).status === 401, 'wrong password rejected');
const meA = (await a.call('GET', '/auth/me')).data.user;
const meB = (await b.call('GET', '/auth/me')).data.user;
check(meA.username === ua && meA.avatar === 'berri', 'me endpoint');

// sockets
const sockA = io(BASE, { extraHeaders: { cookie: a.cookie }, transports: ['websocket'] });
const sockB = io(BASE, { extraHeaders: { cookie: b.cookie }, transports: ['websocket'] });
await Promise.all([sockA, sockB].map((s) => new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); })));
check(true, 'sockets connected with session cookie');

check((await a.call('POST', '/friends', { username: ub })).status === 201, 'A adds B');
const fb = (await b.call('GET', '/friends')).data;
check(fb.addedMe.some((u) => u.id === meA.id), 'B sees "added you"');
await b.call('POST', '/friends', { userId: meA.id });
const fa = (await a.call('GET', '/friends')).data;
check(fa.friends[0]?.mutual === true && fa.friends[0]?.online === true, 'mutual + online');
check((await a.call('GET', `/users/search?q=${ub.slice(0, 4)}`)).data.users.length >= 1, 'user search');

const gotMsg = new Promise((res) => sockB.once('message:new', res));
const conv = (await a.call('POST', '/conversations/direct', { userId: meB.id })).data.conversation;
const again = (await b.call('POST', '/conversations/direct', { userId: meA.id })).data.conversation;
check(conv.id === again.id, 'direct chat is unique per pair');
check((await a.call('POST', `/conversations/${conv.id}/messages`, { kind: 'text', body: 'hi ben!', clientId: 'c1' })).status === 201, 'send text');
check((await gotMsg).body === 'hi ben!', 'B receives message live');
check((await a.call('POST', `/conversations/${conv.id}/messages`, { kind: 'sticker', meta: { stickerId: 'dino-01' } })).status === 201, 'send sticker');
check((await a.call('POST', `/conversations/${conv.id}/messages`, { kind: 'sticker', meta: { stickerId: 'evil' } })).status === 400, 'bad sticker rejected');
const listB = (await b.call('GET', '/conversations')).data.conversations;
check(listB[0]?.unread === 2, 'unread count');
await b.call('POST', `/conversations/${conv.id}/read`);
check((await b.call('GET', '/conversations')).data.conversations[0].unread === 0, 'mark read');
const msgs = (await b.call('GET', `/conversations/${conv.id}/messages`)).data;
check(msgs.messages.length === 2, 'message history');

const group = (await a.call('POST', '/conversations/group', { title: 'Booth crew', memberIds: [meB.id] })).data.conversation;
check(group.isGroup && group.members.length === 2, 'group created');
check((await b.call('PATCH', `/conversations/${group.id}`, { title: 'Crew 2' })).data.conversation.title === 'Crew 2', 'rename group');

// booth
const room = (await a.call('POST', '/rooms', { shots: 2, countdown: 1, conversationId: conv.id })).data.room;
check(/^[A-HJ-NP-Z2-9]{6}$/.test(room.code), `room code ${room.code}`);
const joinA = await sockA.emitWithAck('booth:join', { code: room.code });
const joinB = await sockB.emitWithAck('booth:join', { code: room.code });
check(joinA.ok && joinB.ok && joinB.state.participants.length === 2, 'both join booth');
const signal = new Promise((res) => sockA.once('booth:signal', res));
sockB.emit('booth:signal', { code: room.code, to: meA.id, data: { type: 'offer', sdp: 'x' } });
check((await signal).from === meB.id, 'signal relayed');

const countdowns = [];
sockB.on('booth:countdown', (e) => countdowns.push(e.remaining));
const frame = new Promise((res) => sockB.once('booth:frame', res));
const ended = new Promise((res) => sockB.once('booth:session-end', res));
const started = new Promise((res) => sockA.once('booth:session-start', res));
sockA.emit('booth:start', { code: room.code });
const s = await started;
sockA.emit('booth:frame', { code: room.code, sessionId: s.sessionId, shot: 0, data: 'data:image/jpeg;base64,/9j/AAAA' });
check((await frame).from === meA.id, 'frame relayed');
await ended;
check(countdowns.join(',') === '1,0,1,0', `countdown sequence ${countdowns.join(',')}`);

// photos
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = (await a.call('POST', `/photos?roomCode=${room.code}`, null, tinyPng)).data.photo;
check(photo?.id > 0, 'upload strip');
check((await b.call('GET', `/photos/${photo.id}`)).status === 404, 'strip private before sharing');
await a.call('POST', `/conversations/${conv.id}/messages`, { kind: 'photo', meta: { photoId: photo.id }, body: 'us!' });
check((await b.call('GET', `/photos/${photo.id}`)).status === 200, 'strip visible after sharing');
check((await a.call('POST', '/photos', null, Buffer.from('not an image at all, definitely not'))).status === 415, 'non-image rejected');

// profile
check((await a.call('PATCH', '/users/me', { displayName: 'Amy', bio: 'Snap. Smile. Share.' })).data.user.bio === 'Snap. Smile. Share.', 'edit profile');
const avatar = (await a.call('PUT', '/users/me/avatar', null, tinyPng)).data.user;
check(avatar.avatarUrl?.startsWith('/api/users/images/'), 'avatar upload');
check((await b.call('GET', avatar.avatarUrl.replace('/api', ''))).status === 200, 'avatar served');
const prof = (await b.call('GET', `/users/${ua}`)).data.user;
check(prof.isFriend && prof.addedMe && prof.friendCount === 1, 'public profile');

check((await b.call('POST', `/rooms/${room.code}/close`)).status === 403, 'only host closes booth');
const closed = new Promise((res) => sockB.once('booth:closed', res));
await a.call('POST', `/rooms/${room.code}/close`);
check((await closed).code === room.code, 'booth closed broadcast');

const offline = new Promise((res) => sockA.on('presence', (p) => p.userId === meB.id && !p.online && res(p)));
sockB.disconnect();
check(!!(await offline).lastSeenAt, 'presence offline + last seen');
sockA.disconnect();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
