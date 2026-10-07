import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { api } from '../lib/api';
import { convTitle, preview } from '../lib/conv';
import * as local from '../lib/localdb';
import { notify } from '../lib/notify';
import type { Conversation, Friend, GroupInvite, Message, User } from '../lib/types';
import { useCoins } from './coins';
import { useAuth } from './auth';

type Thread = { items: Message[]; hasMore: boolean; loading: boolean; loaded: boolean };
type Outgoing = (
  | { kind: 'text'; body: string }
  | { kind: 'sticker'; meta: { stickerId: string } }
  | { kind: 'photo'; body?: string; meta: { photoId: number } }
) & { replyToId?: number };

type ChatState = {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  threads: Record<number, Thread>;
  friends: Friend[];
  addedMe: User[];
  friendsLoaded: boolean;
  /** conversationId → userId → expiry timestamp */
  typing: Record<number, Record<number, number>>;
  activeId: number | null;
  /** Group invitations waiting for you to join (with a coin) or decline. */
  invites: GroupInvite[];

  reset: () => void;
  loadInvites: () => Promise<void>;
  loadConversations: () => Promise<void>;
  /** Server data keeps the last message and unread count this device worked out; `local` sets them as given. */
  upsertConversation: (c: Conversation, opts?: { local?: boolean }) => void;
  removeConversation: (id: number) => void;
  loadMessages: (id: number, older?: boolean) => Promise<void>;
  sync: () => Promise<void>;
  send: (id: number, msg: Outgoing, replyTo?: Message) => Promise<void>;
  updateMessage: (m: Message) => void;
  editMessage: (m: Message, body: string) => Promise<void>;
  deleteMessage: (m: Message) => Promise<void>;
  react: (m: Message, emoji: string | null) => Promise<void>;
  retry: (id: number, clientId: string) => Promise<void>;
  receive: (m: Message) => void;
  markRead: (id: number) => void;
  setActive: (id: number | null) => void;
  loadFriends: () => Promise<void>;
  patchUser: (u: Partial<User> & { id: number }) => void;
};

const sortConvs = (list: Conversation[]) =>
  [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const myId = () => useAuth.getState().user?.id;
const emptyThread: Thread = { items: [], hasMore: true, loading: false, loaded: false };
const outgoingPayloads = new Map<string, Outgoing>();
let readTimer: ReturnType<typeof setTimeout> | undefined;

/** Opens this account's on-device chat history. */
function ensureLocal() {
  const me = myId();
  if (!me) throw new Error('Not signed in');
  return local.openLocal(me);
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoaded: false,
  threads: {},
  friends: [],
  addedMe: [],
  friendsLoaded: false,
  typing: {},
  activeId: null,
  invites: [],

  async loadInvites() {
    const r = await api<{ invites: GroupInvite[] }>('/conversations/invites');
    set({ invites: r.invites });
  },

  reset() {
    local.closeLocal();
    pendingAcks.clear();
    set({ conversations: [], conversationsLoaded: false, threads: {}, friends: [], addedMe: [], friendsLoaded: false, typing: {}, activeId: null, invites: [] });
  },

  async loadConversations() {
    const { conversations } = await api<{ conversations: Conversation[] }>('/conversations');
    const withLocal = await Promise.all(conversations.map(localSummary));
    set({ conversations: sortConvs(withLocal), conversationsLoaded: true });
  },

  upsertConversation(c, opts) {
    const existing = get().conversations.find((x) => x.id === c.id);
    const next = opts?.local || !existing ? c : { ...c, lastMessage: existing.lastMessage, unread: existing.unread };
    set({ conversations: sortConvs([next, ...get().conversations.filter((x) => x.id !== c.id)]) });
    if (!existing && !opts?.local) refreshSummary(c.id);
  },

  removeConversation(id) {
    const threads = { ...get().threads };
    delete threads[id];
    set({ conversations: get().conversations.filter((c) => c.id !== id), threads });
    ensureLocal()
      .then(() => local.deleteConversation(id))
      .catch(() => {});
  },

  async loadMessages(id, older = false) {
    const t = get().threads[id] ?? emptyThread;
    if (t.loading || (older && !t.hasMore)) return;
    set({ threads: { ...get().threads, [id]: { ...t, loading: true } } });
    try {
      await ensureLocal();
      const before = older ? t.items.find((m) => m.id > 0)?.id : undefined;
      const r = await local.getThread(id, before);
      const cur = get().threads[id] ?? emptyThread;
      const pending = older ? [] : cur.items.filter((m) => m.pending || m.failed);
      const items = older ? [...r.items, ...cur.items] : mergeById([...r.items, ...cur.items.filter((m) => m.id > 0)], pending);
      set({ threads: { ...get().threads, [id]: { items, hasMore: r.hasMore, loading: false, loaded: true } } });
    } catch (e) {
      set({ threads: { ...get().threads, [id]: { ...(get().threads[id] ?? emptyThread), loading: false } } });
      throw e;
    }
  },

  /** Downloads everything this device hasn't received, stores it, then tells the server it can delete it. */
  async sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        await ensureLocal();
        for (let round = 0; round < 20; round++) {
          const r = await api<{ messages: Message[]; more: boolean }>('/sync');
          for (const m of r.messages) await inbox(() => handle(m, false));
          if (!r.more) break;
        }
        await inbox(() => Promise.resolve());
      } finally {
        syncing = null;
      }
      await flushAcks();
      if (get().conversationsLoaded) await get().loadConversations();
      const active = get().activeId;
      if (active) await get().loadMessages(active);
    })();
    return syncing;
  },

  async send(id, msg, replyTo) {
    const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    if (replyTo) msg = { ...msg, replyToId: replyTo.id };
    outgoingPayloads.set(clientId, msg);
    const optimistic: Message = {
      id: -Date.now(),
      conversationId: id,
      senderId: myId() ?? null,
      kind: msg.kind,
      body: 'body' in msg ? (msg.body ?? '') : '',
      meta: 'meta' in msg ? msg.meta : {},
      createdAt: new Date().toISOString(),
      replyToId: replyTo?.id ?? null,
      replyTo: replyTo ? local.quoteOf(replyTo) : null,
      reactions: {},
      clientId,
      pending: true,
    };
    addToThread(id, optimistic);
    await deliver(id, clientId);
  },

  async retry(id, clientId) {
    updateInThread(id, clientId, { failed: false, pending: true });
    await deliver(id, clientId);
  },

  receive(m) {
    void inbox(() => handle(m, true));
  },

  updateMessage(m) {
    const t = get().threads[m.conversationId];
    if (t) {
      const items = t.items.map((x) => {
        if (x.id === m.id) return { ...x, ...m, clientId: x.clientId };
        // Keep reply quotes in sync with edits and deletes of the original.
        if (x.replyTo?.id === m.id) return { ...x, replyTo: local.quoteOf(m) };
        return x;
      });
      set({ threads: { ...get().threads, [m.conversationId]: { ...t, items } } });
    }
    const conv = get().conversations.find((c) => c.id === m.conversationId);
    if (conv?.lastMessage?.id === m.id) {
      set({ conversations: get().conversations.map((c) => (c.id === conv.id ? { ...c, lastMessage: { ...c.lastMessage!, ...m } } : c)) });
    }
  },

  async editMessage(m, body) {
    const prev = m;
    get().updateMessage({ ...m, body, editedAt: new Date().toISOString() });
    try {
      const r = await api<{ op: Message }>(`/conversations/${m.conversationId}/messages/${m.id}`, { method: 'PATCH', body: { body } });
      get().receive(r.op);
    } catch (e) {
      get().updateMessage(prev);
      throw e;
    }
  },

  async deleteMessage(m) {
    const r = await api<{ op: Message }>(`/conversations/${m.conversationId}/messages/${m.id}`, { method: 'DELETE' });
    get().receive(r.op);
  },

  async react(m, emoji) {
    const me = myId();
    if (!me) return;
    const prev = m;
    const reactions = { ...(m.reactions ?? {}) };
    if (emoji) reactions[me] = emoji;
    else delete reactions[me];
    get().updateMessage({ ...m, reactions });
    try {
      const r = await api<{ op: Message }>(`/conversations/${m.conversationId}/messages/${m.id}/reaction`, {
        method: 'PUT',
        body: { emoji },
      });
      get().receive(r.op);
    } catch (e) {
      get().updateMessage(prev);
      throw e;
    }
  },

  markRead(id) {
    const conv = get().conversations.find((c) => c.id === id);
    if (conv?.unread) get().upsertConversation({ ...conv, unread: 0 }, { local: true });
    clearTimeout(readTimer);
    readTimer = setTimeout(() => api(`/conversations/${id}/read`, { method: 'POST' }).catch(() => {}), 250);
  },

  setActive(id) {
    set({ activeId: id });
    if (id) get().markRead(id);
  },

  async loadFriends() {
    const r = await api<{ friends: Friend[]; addedMe: User[] }>('/friends');
    set({ friends: r.friends, addedMe: r.addedMe, friendsLoaded: true });
  },

  patchUser(u) {
    const patch = <T extends User>(x: T): T => (x.id === u.id ? { ...x, ...u } : x);
    set({
      conversations: get().conversations.map((c) => ({ ...c, members: c.members.map(patch) })),
      friends: get().friends.map(patch),
      addedMe: get().addedMe.map(patch),
    });
    const me = useAuth.getState().user;
    if (me && me.id === u.id) useAuth.getState().setUser({ ...me, ...u });
  },
}));

// ---------------------------------------------------------------- incoming messages

let syncing: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Runs message handling strictly in arrival order (stores are async). */
function inbox(fn: () => Promise<void>) {
  const next = queue.then(fn, fn).catch((e) => console.warn('[chat] could not store a message', e));
  queue = next;
  return next;
}

/** Stores one message from the server (or applies an op), updates the screen and queues its receipt. */
async function handle(m: Message, live: boolean) {
  await ensureLocal();
  const st = useChat.getState();
  queueAck(m.conversationId, m.id);

  if (m.kind === 'op') {
    const updated = await local.applyOp(m);
    if (updated) st.updateMessage(updated);
    return;
  }

  if (m.replyToId && !m.replyTo) {
    const t = await local.getMessage(m.replyToId);
    if (t && t.conversationId === m.conversationId) m = { ...m, replyTo: local.quoteOf(t) };
  }
  const already = await local.getMessage(m.id);
  await local.putMessages([already ? { ...m, reactions: already.reactions ?? m.reactions } : m]);
  addToThread(m.conversationId, m);
  // Before the chat list has loaded (first sync at start-up), the list is built from storage afterwards.
  if (already || !useChat.getState().conversationsLoaded) return;

  const me = myId();
  const conv = st.conversations.find((c) => c.id === m.conversationId);
  if (!conv) {
    // A chat we haven't seen yet (e.g. someone started it) — fetch its summary.
    api<{ conversation: Conversation }>(`/conversations/${m.conversationId}`)
      .then(async ({ conversation }) => {
        useChat.getState().upsertConversation(await localSummary(conversation), { local: true });
        if (live) notifyMessage(conversation, m);
      })
      .catch(() => {});
    return;
  }
  const viewing = st.activeId === m.conversationId && document.visibilityState === 'visible';
  const fromOther = m.senderId !== me && m.senderId !== null;
  const typing = { ...useChat.getState().typing };
  if (m.senderId && typing[m.conversationId]) {
    const t = { ...typing[m.conversationId] };
    delete t[m.senderId];
    typing[m.conversationId] = t;
  }
  const newer = !conv.lastMessage || m.id >= conv.lastMessage.id;
  useChat.getState().upsertConversation(
    {
      ...conv,
      lastMessage: newer ? m : conv.lastMessage,
      updatedAt: newer ? m.createdAt : conv.updatedAt,
      unread: fromOther && !viewing && new Date(m.createdAt) > new Date(conv.lastReadAt) ? conv.unread + 1 : conv.unread,
    },
    { local: true },
  );
  useChat.setState({ typing });
  if (viewing && fromOther) st.markRead(m.conversationId);
  else if (live) notifyMessage(conv, m);
}

// ---------------------------------------------------------------- receipts

const pendingAcks = new Map<number, number>();
let ackTimer: ReturnType<typeof setTimeout> | undefined;

function queueAck(conversationId: number, id: number) {
  if (id <= 0) return;
  pendingAcks.set(conversationId, Math.max(id, pendingAcks.get(conversationId) ?? 0));
  clearTimeout(ackTimer);
  ackTimer = setTimeout(() => void flushAcks(), 800);
}

/**
 * Tells the server what this device has stored so it can delete it. Held back during a sync: a receipt
 * says "I have everything up to here", which is only true once the catch-up has finished.
 */
async function flushAcks() {
  if (syncing || !pendingAcks.size) return;
  await queue;
  const upTo = Object.fromEntries(pendingAcks);
  pendingAcks.clear();
  try {
    await api('/sync/ack', { body: { upTo } });
  } catch {
    for (const [c, id] of Object.entries(upTo)) queueAck(Number(c), id);
  }
}

// ---------------------------------------------------------------- chat list from local history

/** Fills in a chat's last message and unread count from what this device has stored. */
async function localSummary(c: Conversation): Promise<Conversation> {
  const me = myId();
  if (!me) return c;
  try {
    await ensureLocal();
    const s = await local.summary(c.id, c.lastReadAt, me);
    return s.last ? { ...c, lastMessage: s.last, unread: s.unread } : c;
  } catch {
    return c;
  }
}

function refreshSummary(id: number) {
  const c = useChat.getState().conversations.find((x) => x.id === id);
  if (!c) return;
  localSummary(c).then((next) => {
    if (useChat.getState().conversations.some((x) => x.id === id)) useChat.getState().upsertConversation(next, { local: true });
  });
}

/** Pops up / chimes for a message from someone else, unless that chat is open or muted. */
function notifyMessage(conv: Conversation, m: Message) {
  const me = myId();
  if (!me || m.senderId === me || m.senderId === null || conv.muted) return;
  const viewing = useChat.getState().activeId === conv.id && document.visibilityState === 'visible';
  if (viewing) return;
  const sender = conv.members.find((u) => u.id === m.senderId);
  const name = sender?.displayName ?? 'Someone';
  notify({
    title: conv.isGroup ? `${name} · ${convTitle(conv, me)}` : name,
    body: m.kind === 'text' ? m.body : preview(m, me, conv.members),
    to: `/chats/${conv.id}`,
    user: sender,
    tag: `chat:${conv.id}`,
  });
}

function mergeById(stored: Message[], pending: Message[]) {
  const seen = new Map<number, Message>();
  for (const m of stored) seen.set(m.id, m);
  const done = new Set(stored.map((m) => m.clientId).filter(Boolean));
  return [...[...seen.values()].sort((a, b) => a.id - b.id), ...pending.filter((p) => !done.has(p.clientId))];
}

function addToThread(id: number, m: Message) {
  const { threads } = useChat.getState();
  const t = threads[id] ?? emptyThread;
  if (m.id > 0 && t.items.some((x) => x.id === m.id)) return;
  let items: Message[];
  const idx = m.clientId ? t.items.findIndex((x) => x.clientId === m.clientId && x.id < 0) : -1;
  if (idx >= 0) {
    items = [...t.items];
    items[idx] = { ...m, pending: false, failed: false };
  } else if (m.id > 0) {
    // Keep confirmed messages ordered by id, pending ones at the end.
    const confirmed = t.items.filter((x) => x.id > 0);
    const pending = t.items.filter((x) => x.id < 0);
    items = [...confirmed, m].sort((a, b) => a.id - b.id).concat(pending);
  } else {
    items = [...t.items, m];
  }
  useChat.setState({ threads: { ...threads, [id]: { ...t, items } } });
}

function updateInThread(id: number, clientId: string, patch: Partial<Message>) {
  const { threads } = useChat.getState();
  const t = threads[id];
  if (!t) return;
  useChat.setState({
    threads: { ...threads, [id]: { ...t, items: t.items.map((m) => (m.clientId === clientId && m.id < 0 ? { ...m, ...patch } : m)) } },
  });
}

async function deliver(id: number, clientId: string) {
  const payload = outgoingPayloads.get(clientId);
  if (!payload) return;
  try {
    const { message } = await api<{ message: Message }>(`/conversations/${id}/messages`, {
      body: { ...payload, clientId },
    });
    outgoingPayloads.delete(clientId);
    useChat.getState().receive({ ...message, clientId });
  } catch {
    updateInThread(id, clientId, { pending: false, failed: true });
  }
}

/** Wires server events into the store. Called once per socket. */
export function bindChatSocket(s: Socket) {
  const st = useChat.getState;
  s.on('connect', () => {
    // Catch up on anything that arrived while disconnected.
    st().sync().catch(() => {});
    st().loadInvites().catch(() => {});
    if (st().friendsLoaded) st().loadFriends().catch(() => {});
  });
  s.on('message:new', (m: Message) => st().receive(m));
  s.on('message:deleted', ({ conversationId, messageIds }: { conversationId: number; messageIds: number[] }) => {
    const t = st().threads[conversationId];
    if (t) {
      useChat.setState({
        threads: { ...st().threads, [conversationId]: { ...t, items: t.items.filter((m) => !messageIds.includes(m.id)) } },
      });
    }
    ensureLocal()
      .then(() => local.deleteMessages(messageIds))
      .then(() => refreshSummary(conversationId))
      .catch(() => {});
  });
  s.on('conversation:new', (c: Conversation) => st().upsertConversation(c));
  s.on('conversation:updated', (c: Conversation) => st().upsertConversation(c));
  s.on('conversation:removed', ({ id }: { id: number }) => st().removeConversation(id));
  s.on('conversation:read', ({ conversationId, userId, lastReadAt }: { conversationId: number; userId: number; lastReadAt: string }) => {
    const c = st().conversations.find((x) => x.id === conversationId);
    if (!c) return;
    const next = { ...c, readStates: { ...c.readStates, [userId]: lastReadAt } };
    if (userId === myId()) {
      next.unread = 0;
      next.lastReadAt = lastReadAt;
    }
    useChat.setState({ conversations: st().conversations.map((x) => (x.id === conversationId ? next : x)) });
  });
  s.on('presence', ({ userId, online, lastSeenAt }: { userId: number; online: boolean; lastSeenAt?: string }) => {
    st().patchUser({ id: userId, online, ...(lastSeenAt ? { lastSeenAt } : {}) });
  });
  s.on('user:updated', (u: User) => st().patchUser(u));
  s.on('friends:changed', () => {
    if (st().friendsLoaded) st().loadFriends().catch(() => {});
  });
  s.on('friends:added', ({ user, mutual }: { user: User | null; mutual: boolean }) => {
    if (!user) return;
    notify({
      title: user.displayName,
      body: mutual ? 'added you back — you’re friends now 💕' : 'added you as a friend',
      to: `/u/${user.username}`,
      user,
      tag: `friend:${user.id}`,
    });
  });
  s.on('coins:changed', (b: { coins: number; memorySlots: number }) => useCoins.getState().setBalance(b));
  s.on('coins:gift', ({ from, amount, note }: { from: User | null; amount: number; note: string | null }) => {
    notify({
      title: `${from?.displayName ?? 'A friend'} sent you ${amount} ${amount === 1 ? 'coin' : 'coins'} 🪙`,
      body: note || 'Tap the coin button to see your balance',
      to: '/chats',
      user: from ?? undefined,
      tag: `gift:${from?.id ?? 0}`,
    });
  });
  s.on('invites:changed', () => {
    const before = st().invites.length;
    st()
      .loadInvites()
      .then(() => {
        const inv = st().invites[0];
        if (st().invites.length > before && inv) {
          notify({
            title: `${inv.invitedBy?.displayName ?? 'Someone'} invited you to ${inv.title || 'a group'}`,
            body: 'Open Chats to join',
            to: '/chats',
            user: inv.invitedBy ?? undefined,
            tag: `invite:${inv.conversationId}`,
          });
        }
      })
      .catch(() => {});
  });
  s.on('typing', ({ conversationId, userId, typing }: { conversationId: number; userId: number; typing: boolean }) => {
    const cur = { ...(st().typing[conversationId] ?? {}) };
    if (typing) cur[userId] = Date.now() + 6000;
    else delete cur[userId];
    useChat.setState({ typing: { ...st().typing, [conversationId]: cur } });
  });
}

/** Names of people currently typing in a chat (entries expire after 6 s). */
export function typingIn(state: ChatState, conversationId: number, now = Date.now()) {
  const t = state.typing[conversationId] ?? {};
  return Object.entries(t)
    .filter(([, exp]) => exp > now)
    .map(([uid]) => Number(uid));
}
