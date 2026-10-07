import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { api } from '../lib/api';
import { convTitle, preview } from '../lib/conv';
import { notify } from '../lib/notify';
import type { Conversation, Friend, Message, User } from '../lib/types';
import { useAuth } from './auth';

type Thread = { items: Message[]; hasMore: boolean; loading: boolean; loaded: boolean };
type Outgoing =
  | { kind: 'text'; body: string }
  | { kind: 'sticker'; meta: { stickerId: string } }
  | { kind: 'photo'; body?: string; meta: { photoId: number } };

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

  reset: () => void;
  loadConversations: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: number) => void;
  loadMessages: (id: number, older?: boolean) => Promise<void>;
  send: (id: number, msg: Outgoing) => Promise<void>;
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

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoaded: false,
  threads: {},
  friends: [],
  addedMe: [],
  friendsLoaded: false,
  typing: {},
  activeId: null,

  reset() {
    set({ conversations: [], conversationsLoaded: false, threads: {}, friends: [], addedMe: [], friendsLoaded: false, typing: {}, activeId: null });
  },

  async loadConversations() {
    const { conversations } = await api<{ conversations: Conversation[] }>('/conversations');
    set({ conversations: sortConvs(conversations), conversationsLoaded: true });
  },

  upsertConversation(c) {
    const rest = get().conversations.filter((x) => x.id !== c.id);
    set({ conversations: sortConvs([c, ...rest]) });
  },

  removeConversation(id) {
    const threads = { ...get().threads };
    delete threads[id];
    set({ conversations: get().conversations.filter((c) => c.id !== id), threads });
  },

  async loadMessages(id, older = false) {
    const t = get().threads[id] ?? emptyThread;
    if (t.loading || (older && !t.hasMore)) return;
    set({ threads: { ...get().threads, [id]: { ...t, loading: true } } });
    try {
      const before = older ? t.items.find((m) => m.id > 0)?.id : undefined;
      const r = await api<{ messages: Message[]; hasMore: boolean }>(
        `/conversations/${id}/messages${before ? `?before=${before}` : ''}`,
      );
      const cur = get().threads[id] ?? emptyThread;
      const pending = older ? [] : cur.items.filter((m) => m.pending || m.failed);
      const items = older ? [...r.messages, ...cur.items] : mergeById([...r.messages, ...cur.items.filter((m) => m.id > 0)], pending);
      set({ threads: { ...get().threads, [id]: { items, hasMore: r.hasMore, loading: false, loaded: true } } });
    } catch (e) {
      set({ threads: { ...get().threads, [id]: { ...(get().threads[id] ?? emptyThread), loading: false } } });
      throw e;
    }
  },

  async send(id, msg) {
    const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    outgoingPayloads.set(clientId, msg);
    const optimistic: Message = {
      id: -Date.now(),
      conversationId: id,
      senderId: myId() ?? null,
      kind: msg.kind,
      body: 'body' in msg ? (msg.body ?? '') : '',
      meta: 'meta' in msg ? msg.meta : {},
      createdAt: new Date().toISOString(),
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
    const me = myId();
    addToThread(m.conversationId, m);
    const conv = get().conversations.find((c) => c.id === m.conversationId);
    if (!conv) {
      // A chat we haven't seen yet (e.g. someone started it) — fetch its summary.
      api<{ conversation: Conversation }>(`/conversations/${m.conversationId}`)
        .then(({ conversation }) => {
          get().upsertConversation(conversation);
          notifyMessage(conversation, m);
        })
        .catch(() => {});
      return;
    }
    const viewing = get().activeId === m.conversationId && document.visibilityState === 'visible';
    const fromOther = m.senderId !== me && m.senderId !== null;
    const typing = { ...get().typing };
    if (m.senderId && typing[m.conversationId]) {
      const t = { ...typing[m.conversationId] };
      delete t[m.senderId];
      typing[m.conversationId] = t;
    }
    get().upsertConversation({
      ...conv,
      lastMessage: m,
      updatedAt: m.createdAt,
      unread: fromOther && !viewing ? conv.unread + 1 : conv.unread,
    });
    set({ typing });
    if (viewing && fromOther) get().markRead(m.conversationId);
    else notifyMessage(conv, m);
  },

  markRead(id) {
    const conv = get().conversations.find((c) => c.id === id);
    if (conv?.unread) get().upsertConversation({ ...conv, unread: 0 });
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

function mergeById(server: Message[], pending: Message[]) {
  const seen = new Map<number, Message>();
  for (const m of server) seen.set(m.id, m);
  const done = new Set(server.map((m) => m.clientId).filter(Boolean));
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
    // Catch up on anything missed while disconnected.
    if (st().conversationsLoaded) st().loadConversations().catch(() => {});
    const active = st().activeId;
    if (active) st().loadMessages(active).catch(() => {});
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
    st().loadConversations().catch(() => {});
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
