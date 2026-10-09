import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { one, query } from '../db.js';
import { HttpError } from '../http.js';
import { audienceOf, getUser, memberIds, type PublicUser } from '../model.js';
import { safeArtwork, songFromVideo, videoForTrack, videoIdFromLink, VIDEO_ID } from '../songs.js';
import { emitToUsers, getIo } from './hub.js';

/**
 * Chill Room engine. The server owns the truth — the queue, which song is on and where it is — as
 * "position P at server time T, playing or paused". Every phone works out where the song should be
 * right now from that and nudges its YouTube player to match, so everyone hears the same moment.
 */

const MAX_QUEUE = 100;
const KEEP_PLAYED = 20;
const MAX_CHAT = 100;
const END_GRACE_MS = 1500;

export const CHILL_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'That room code doesn’t look right');

export type QueueItem = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  videoId: string;
  durationMs: number | null;
  addedBy: number;
  by: Person | null;
};

type Person = { id: number; displayName: string; avatar: string; avatarUrl: string | null };

export type ChatLine = { id: string; kind: 'text' | 'event'; user: Person | null; text: string; at: number };

type Saved = { queue: QueueItem[]; index: number; playing: boolean; positionMs: number; finished: boolean; chat: ChatLine[] };

export type ChillRow = {
  id: number;
  code: string;
  host_id: number;
  conversation_id: number | null;
  status: 'open' | 'closed';
  data: Partial<Saved>;
  created_at: Date;
  expires_at: Date;
};

type Listener = { socketId: string; userId: number; user: PublicUser; joinedAt: number };

type Session = Saved & {
  code: string;
  hostId: number;
  conversationId: number | null;
  /** Server clock (ms) when positionMs was true. */
  anchorAt: number;
  listeners: Map<string, Listener>;
  endTimer: NodeJS.Timeout | null;
  saveTimer: NodeJS.Timeout | null;
  liveTimer: NodeJS.Timeout | null;
  greeted: Set<number>;
};

const sessions = new Map<string, Session>();
const roomOf = (code: string) => `chill:${code}`;

export async function findOpenChill(code: string) {
  return one<ChillRow>(`SELECT * FROM chill_rooms WHERE code = $1 AND status = 'open' AND expires_at > now()`, [code]);
}

// ---------- state helpers ----------

const current = (s: Session) => s.queue[s.index] ?? null;
const positionNow = (s: Session) => (s.playing ? s.positionMs + (Date.now() - s.anchorAt) : s.positionMs);

function uniqueListeners(s: Session) {
  const byUser = new Map<number, Listener>();
  for (const l of [...s.listeners.values()].sort((a, b) => a.joinedAt - b.joinedAt)) if (!byUser.has(l.userId)) byUser.set(l.userId, l);
  return [...byUser.values()];
}

function stateOf(s: Session) {
  return {
    code: s.code,
    hostId: s.hostId,
    conversationId: s.conversationId,
    queue: s.queue,
    index: s.index,
    playing: s.playing,
    positionMs: s.positionMs,
    anchorAt: s.anchorAt,
    finished: s.finished,
    listeners: uniqueListeners(s).map((l) => l.user),
  };
}

function broadcast(s: Session) {
  getIo().to(roomOf(s.code)).emit('chill:state', { ...stateOf(s), serverNow: Date.now() });
  scheduleSave(s);
  scheduleLive(s);
}

/** Moves the play head and (re)arms the timer that moves on to the next song. */
function setPlayhead(s: Session, positionMs: number, playing: boolean) {
  const item = current(s);
  const max = item?.durationMs ?? Infinity;
  s.positionMs = Math.max(0, Math.min(positionMs, max));
  s.anchorAt = Date.now();
  s.playing = playing && !!item;
  if (s.playing) s.finished = false;
  if (s.endTimer) clearTimeout(s.endTimer);
  s.endTimer = null;
  if (s.playing && item?.durationMs) {
    const left = item.durationMs - s.positionMs + END_GRACE_MS;
    const id = item.id;
    s.endTimer = setTimeout(() => current(s)?.id === id && advance(s), Math.max(0, left));
  }
}

function advance(s: Session) {
  if (s.index < s.queue.length - 1) {
    s.index++;
    trimPlayed(s);
    setPlayhead(s, 0, true);
  } else {
    // End of the queue: stay on the last song, stopped, until someone adds more.
    setPlayhead(s, current(s)?.durationMs ?? 0, false);
    s.finished = true;
  }
  broadcast(s);
}

function trimPlayed(s: Session) {
  const extra = s.index - KEEP_PLAYED;
  if (extra > 0) {
    s.queue.splice(0, extra);
    s.index -= extra;
  }
}

function person(u: PublicUser): Person {
  return { id: u.id, displayName: u.displayName, avatar: u.avatar, avatarUrl: u.avatarUrl };
}

function say(s: Session, line: Omit<ChatLine, 'id' | 'at'>) {
  const full: ChatLine = { ...line, id: crypto.randomUUID(), at: Date.now() };
  s.chat.push(full);
  if (s.chat.length > MAX_CHAT) s.chat.splice(0, s.chat.length - MAX_CHAT);
  getIo().to(roomOf(s.code)).emit('chill:chat', { code: s.code, line: full });
  scheduleSave(s);
}

// ---------- persistence & "who's live" ----------

function saved(s: Session): Saved {
  return { queue: s.queue, index: s.index, playing: s.playing, positionMs: positionNow(s), finished: s.finished, chat: s.chat };
}

function scheduleSave(s: Session) {
  if (s.saveTimer) return;
  s.saveTimer = setTimeout(() => {
    s.saveTimer = null;
    save(s);
  }, 1500);
}

function save(s: Session) {
  return query(`UPDATE chill_rooms SET data = $2, expires_at = now() + interval '24 hours' WHERE code = $1 AND status = 'open'`, [
    s.code,
    JSON.stringify(saved(s)),
  ]).catch((e) => console.error('[chill] save failed', e.message));
}

/** Tells friends and the linked chat that the room changed, so "Live now" and chat strips stay fresh. */
function scheduleLive(s: Session) {
  if (s.liveTimer) return;
  s.liveTimer = setTimeout(() => {
    s.liveTimer = null;
    notifyTogether(s.hostId, s.conversationId);
  }, 1200);
}

export async function notifyTogether(hostId: number, conversationId: number | null) {
  try {
    const people = new Set<number>([hostId, ...(await audienceOf(hostId))]);
    if (conversationId) for (const id of await memberIds(conversationId)) people.add(id);
    emitToUsers(people, 'together:changed', {});
  } catch (e) {
    console.error('[chill] live notify failed', (e as Error).message);
  }
}

/** Rooms with someone in them right now. */
export function liveChillRooms() {
  return [...sessions.values()]
    .filter((s) => s.listeners.size > 0)
    .map((s) => {
      const item = current(s);
      return {
        code: s.code,
        hostId: s.hostId,
        conversationId: s.conversationId,
        listeners: uniqueListeners(s).map((l) => l.user),
        nowPlaying: item && !s.finished ? { title: item.title, artist: item.artist, artwork: item.artwork, playing: s.playing } : null,
      };
    });
}

export function closeChill(code: string) {
  const s = sessions.get(code);
  const io = getIo();
  io.to(roomOf(code)).emit('chill:closed', { code });
  io.in(roomOf(code)).socketsLeave(roomOf(code));
  if (!s) return;
  for (const t of [s.endTimer, s.saveTimer, s.liveTimer]) if (t) clearTimeout(t);
  sessions.delete(code);
  notifyTogether(s.hostId, s.conversationId);
}

function sessionFromRow(row: ChillRow): Session {
  const d = row.data ?? {};
  const queue = Array.isArray(d.queue) ? d.queue : [];
  return {
    code: row.code,
    hostId: row.host_id,
    conversationId: row.conversation_id,
    queue,
    index: Math.min(Math.max(0, d.index ?? 0), Math.max(0, queue.length - 1)),
    // Everyone left (or the server restarted): pick up where it was, paused.
    playing: false,
    positionMs: d.positionMs ?? 0,
    finished: d.finished ?? false,
    chat: Array.isArray(d.chat) ? d.chat : [],
    anchorAt: Date.now(),
    listeners: new Map(),
    endTimer: null,
    saveTimer: null,
    liveTimer: null,
    greeted: new Set(),
  };
}

function removeListener(code: string, socketId: string) {
  const s = sessions.get(code);
  if (!s?.listeners.delete(socketId)) return;
  getIo().sockets.sockets.get(socketId)?.leave(roomOf(code));
  if (s.listeners.size) return broadcast(s);
  // Last one out: pause, save and let the room sleep until someone comes back.
  setPlayhead(s, positionNow(s), false);
  for (const t of [s.endTimer, s.saveTimer, s.liveTimer]) if (t) clearTimeout(t);
  sessions.delete(code);
  save(s);
  notifyTogether(s.hostId, s.conversationId);
}

// ---------- socket API ----------

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});
const errText = (e: unknown, fallback: string) => (e instanceof HttpError ? e.message : fallback);

const songInput = z.union([
  z.object({ link: z.string().trim().min(5).max(300) }),
  z.object({
    trackId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    artist: z.string().trim().max(200),
    artwork: z.string().max(500).nullish(),
    durationMs: z.number().int().positive().max(60 * 60_000).nullish(),
  }),
]);

export function attachChill(socket: Socket) {
  const userId: number = socket.data.userId;
  const joined = new Set<string>();
  let lastChat = 0;
  let lastControl = 0;

  const sessionFor = (raw: unknown) => {
    const parsed = CHILL_CODE.safeParse(raw);
    if (!parsed.success) return null;
    const s = sessions.get(parsed.data);
    return s?.listeners.has(socket.id) ? s : null;
  };
  const nameOf = (s: Session) => [...s.listeners.values()].find((l) => l.userId === userId)?.user;

  socket.on('chill:ping', (_p: unknown, ackFn: unknown) => safeAck(ackFn)({ serverNow: Date.now() }));

  socket.on('chill:join', async (payload: { code?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    try {
      const parsed = CHILL_CODE.safeParse(payload?.code);
      if (!parsed.success) return ack({ error: 'That room code doesn’t look right' });
      const code = parsed.data;
      let s = sessions.get(code);
      if (!s) {
        const row = await findOpenChill(code);
        if (!row) return ack({ error: 'This Chill Room has closed' });
        s = sessions.get(code) ?? sessionFromRow(row); // someone else may have woken it meanwhile
        sessions.set(code, s);
      }
      const user = await getUser(userId);
      if (!user) return ack({ error: 'Please log in again' });
      s.listeners.set(socket.id, { socketId: socket.id, userId, user, joinedAt: Date.now() });
      joined.add(code);
      await socket.join(roomOf(code));
      if (!s.greeted.has(userId)) {
        s.greeted.add(userId);
        say(s, { kind: 'event', user: person(user), text: 'joined the room' });
      }
      broadcast(s);
      ack({ ok: true, state: stateOf(s), chat: s.chat, serverNow: Date.now() });
    } catch (e) {
      console.error('[chill] join failed', e);
      ack({ error: 'Couldn’t open the Chill Room' });
    }
  });

  socket.on('chill:leave', (payload: { code?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s) return;
    joined.delete(s.code);
    removeListener(s.code, socket.id);
  });

  socket.on(
    'chill:control',
    (payload: { code?: string; action?: string; positionMs?: number; itemId?: string; expectId?: string }) => {
      const s = sessionFor(payload?.code);
      if (!s) return;
      const now = Date.now();
      if (now - lastControl < 200) return;
      lastControl = now;
      // Taps made while looking at an older song are ignored rather than applied to the new one.
      if (payload.expectId && current(s)?.id !== payload.expectId && payload.action !== 'jump') return;
      switch (payload.action) {
        case 'play':
          if (s.finished && current(s)) setPlayhead(s, 0, true);
          else setPlayhead(s, positionNow(s), true);
          break;
        case 'pause':
          setPlayhead(s, positionNow(s), false);
          break;
        case 'seek': {
          const pos = Number(payload.positionMs);
          if (!Number.isFinite(pos)) return;
          setPlayhead(s, pos, s.playing || s.finished);
          break;
        }
        case 'next':
          if (s.index >= s.queue.length - 1) return;
          return advance(s);
        case 'prev':
          if (positionNow(s) > 5000 || s.index === 0) setPlayhead(s, 0, s.playing || s.finished);
          else {
            s.index--;
            setPlayhead(s, 0, true);
          }
          break;
        case 'jump': {
          const i = s.queue.findIndex((q) => q.id === payload.itemId);
          if (i < 0) return;
          s.index = i;
          trimPlayed(s);
          setPlayhead(s, 0, true);
          break;
        }
        default:
          return;
      }
      broadcast(s);
    },
  );

  // A player reached the end of the video. The server's own timer usually gets there first.
  socket.on('chill:ended', (payload: { code?: string; itemId?: string }) => {
    const s = sessionFor(payload?.code);
    const item = s && current(s);
    if (!s || !item || item.id !== payload.itemId || !s.playing) return;
    const pos = positionNow(s);
    if (item.durationMs ? pos < item.durationMs - 8000 : pos < 15_000) return;
    advance(s);
  });

  // The player learned the real length of a song (pasted links arrive without one).
  socket.on('chill:duration', (payload: { code?: string; itemId?: string; durationMs?: number }) => {
    const s = sessionFor(payload?.code);
    const item = s?.queue.find((q) => q.id === payload?.itemId);
    const ms = Number(payload?.durationMs);
    if (!s || !item || item.durationMs || !Number.isFinite(ms) || ms < 5000 || ms > 4 * 3600_000) return;
    item.durationMs = Math.round(ms);
    if (current(s)?.id === item.id) setPlayhead(s, positionNow(s), s.playing);
    broadcast(s);
  });

  // YouTube wouldn't play it (removed, blocked in a country…): skip it for everyone.
  socket.on('chill:unplayable', (payload: { code?: string; itemId?: string }) => {
    const s = sessionFor(payload?.code);
    const item = s && current(s);
    if (!s || !item || item.id !== payload.itemId) return;
    say(s, { kind: 'event', user: null, text: `Couldn’t play ${item.title} — skipped it` });
    advance(s);
  });

  socket.on('chill:add', async (payload: { code?: string; song?: unknown }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const s = sessionFor(payload?.code);
    if (!s) return ack({ error: 'You’re not in this room' });
    if (s.queue.length - s.index >= MAX_QUEUE) return ack({ error: 'The queue is full' });
    const parsed = songInput.safeParse(payload?.song);
    if (!parsed.success) return ack({ error: 'That song didn’t come through — try again' });
    try {
      let song;
      if ('link' in parsed.data) {
        const videoId = videoIdFromLink(parsed.data.link) ?? (VIDEO_ID.test(parsed.data.link) ? parsed.data.link : null);
        if (!videoId) return ack({ error: 'Paste a YouTube link, or search by song name' });
        song = await songFromVideo(videoId);
      } else {
        const t = parsed.data;
        const video = await videoForTrack({ trackId: t.trackId, title: t.title, artist: t.artist, durationMs: t.durationMs ?? null });
        song = { title: t.title, artist: t.artist, artwork: safeArtwork(t.artwork), ...video };
      }
      const live = sessions.get(s.code);
      if (!live?.listeners.has(socket.id)) return ack({ error: 'You left the room' });
      const me = nameOf(live);
      const item: QueueItem = { id: crypto.randomUUID(), ...song, addedBy: userId, by: me ? person(me) : null };
      const startNow = live.queue.length === 0 || live.finished;
      live.queue.push(item);
      if (startNow) {
        live.index = live.queue.length - 1;
        trimPlayed(live);
        setPlayhead(live, 0, true);
      }
      say(live, { kind: 'event', user: item.by, text: `added ${item.title} to the queue` });
      broadcast(live);
      ack({ ok: true, item });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[chill] add failed', e);
      ack({ error: errText(e, 'Couldn’t add that song — try again') });
    }
  });

  socket.on('chill:remove', (payload: { code?: string; itemId?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s) return;
    const i = s.queue.findIndex((q) => q.id === payload.itemId);
    // Upcoming songs only; whoever added it or the host can take it off.
    if (i <= s.index || (s.queue[i].addedBy !== userId && s.hostId !== userId)) return;
    s.queue.splice(i, 1);
    broadcast(s);
  });

  socket.on('chill:shuffle', (payload: { code?: string }) => {
    const s = sessionFor(payload?.code);
    if (!s) return;
    const upcoming = s.queue.splice(s.index + 1);
    if (upcoming.length < 2) return void s.queue.push(...upcoming);
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    s.queue.push(...upcoming);
    const me = nameOf(s);
    say(s, { kind: 'event', user: me ? person(me) : null, text: 'shuffled the queue' });
    broadcast(s);
  });

  socket.on('chill:chat', (payload: { code?: string; text?: string }) => {
    const s = sessionFor(payload?.code);
    const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 300) : '';
    if (!s || !text) return;
    const now = Date.now();
    if (now - lastChat < 400) return;
    lastChat = now;
    const me = nameOf(s);
    if (me) say(s, { kind: 'text', user: person(me), text });
  });

  socket.on('disconnect', () => {
    for (const code of joined) removeListener(code, socket.id);
    joined.clear();
  });
}
