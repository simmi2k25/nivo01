import type { Message, ReplyPreview } from './types';

/**
 * Chat history lives on this device (IndexedDB), one database per account. The server deletes messages
 * once every member's devices have received them, so this is the only lasting copy.
 */

const STORE = 'messages';
let dbPromise: Promise<IDBDatabase> | null = null;
let dbUser: number | null = null;

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Opens (once) the database for the signed-in account. */
export function openLocal(userId: number) {
  if (dbPromise && dbUser === userId) return dbPromise;
  dbUser = userId;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(`nivotalk-u${userId}`, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('byConv', ['conversationId', 'id']);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

export function closeLocal() {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  dbUser = null;
}

function db() {
  if (!dbPromise) throw new Error('Local chat storage is not open');
  return dbPromise;
}

/** Strips client-only delivery state before saving. */
function clean(m: Message): Message {
  const { pending: _p, failed: _f, ...rest } = m;
  return rest;
}

export async function putMessages(list: Message[]) {
  if (!list.length) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const m of list) if (m.id > 0) store.put(clean(m));
  await done(tx);
}

export async function getMessage(id: number) {
  const tx = (await db()).transaction(STORE);
  return (await req(tx.objectStore(STORE).get(id))) as Message | undefined;
}

/** A page of a chat, oldest first: the newest `limit` messages, or those before `beforeId`. */
export async function getThread(conversationId: number, beforeId?: number, limit = 40) {
  const tx = (await db()).transaction(STORE);
  const range = IDBKeyRange.bound([conversationId, 0], [conversationId, beforeId ? beforeId - 1 : Number.MAX_SAFE_INTEGER]);
  const items: Message[] = [];
  let hasMore = false;
  await new Promise<void>((resolve, reject) => {
    const cur = tx.objectStore(STORE).index('byConv').openCursor(range, 'prev');
    cur.onerror = () => reject(cur.error);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve();
      if (items.length === limit) {
        hasMore = true;
        return resolve();
      }
      items.push(c.value as Message);
      c.continue();
    };
  });
  return { items: await withQuotes(items.reverse()), hasMore };
}

/** Rebuilds reply quotes from the stored originals, so edits and deletions show up in them. */
async function withQuotes(items: Message[]) {
  const ids = [...new Set(items.map((m) => m.replyToId).filter((x): x is number => !!x))];
  if (!ids.length) return items;
  const byId = new Map<number, Message>();
  for (const m of items) byId.set(m.id, m);
  for (const id of ids) if (!byId.has(id)) {
    const m = await getMessage(id);
    if (m) byId.set(id, m);
  }
  return items.map((m) => {
    if (!m.replyToId) return m;
    const t = byId.get(m.replyToId);
    // Only quote a message from the same chat.
    return t && t.conversationId === m.conversationId ? { ...m, replyTo: quoteOf(t) } : m;
  });
}

export const quoteOf = (t: Message): ReplyPreview => ({
  id: t.id,
  senderId: t.senderId,
  kind: t.kind,
  body: t.deletedAt ? '' : t.body.slice(0, 200),
  deleted: !!t.deletedAt,
});

/** The newest message and the unread count for one chat, from what's stored here. */
export async function summary(conversationId: number, lastReadAt: string, meId: number) {
  const tx = (await db()).transaction(STORE);
  const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
  const since = new Date(lastReadAt).getTime();
  let last: Message | null = null;
  let unread = 0;
  await new Promise<void>((resolve, reject) => {
    const cur = tx.objectStore(STORE).index('byConv').openCursor(range, 'prev');
    cur.onerror = () => reject(cur.error);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve();
      const m = c.value as Message;
      if (!last) last = m;
      if (new Date(m.createdAt).getTime() <= since) return resolve();
      if (m.senderId !== meId) unread++;
      c.continue();
    };
  });
  return { last: last as Message | null, unread };
}

export async function deleteMessages(ids: number[]) {
  if (!ids.length) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  for (const id of ids) tx.objectStore(STORE).delete(id);
  await done(tx);
}

/** Forgets a whole chat on this device (e.g. after leaving a group). */
export async function deleteConversation(conversationId: number) {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
  const keys = await req(tx.objectStore(STORE).index('byConv').getAllKeys(range));
  for (const k of keys) tx.objectStore(STORE).delete(k);
  await done(tx);
}

/**
 * Applies an edit / delete / reaction op to the stored original. Edits and deletes only count when they
 * come from the original's sender. Returns the updated message, or null if there's nothing to change.
 */
export async function applyOp(op: Message): Promise<Message | null> {
  const targetId = Number(op.meta?.targetId);
  if (!targetId || !op.senderId) return null;
  const t = await getMessage(targetId);
  if (!t || t.conversationId !== op.conversationId || t.deletedAt) return null;
  let next: Message | null = null;
  switch (op.meta.op) {
    case 'edit':
      if (t.senderId === op.senderId && t.kind === 'text' && typeof op.meta.body === 'string') {
        next = { ...t, body: op.meta.body, editedAt: op.createdAt };
      }
      break;
    case 'delete':
      if (t.senderId === op.senderId) next = { ...t, body: '', meta: {}, reactions: {}, deletedAt: op.createdAt };
      break;
    case 'react': {
      const reactions = { ...(t.reactions ?? {}) };
      if (typeof op.meta.emoji === 'string') reactions[op.senderId] = op.meta.emoji;
      else delete reactions[op.senderId];
      next = { ...t, reactions };
      break;
    }
  }
  if (next) await putMessages([next]);
  return next;
}
