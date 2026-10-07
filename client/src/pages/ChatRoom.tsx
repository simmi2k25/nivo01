import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { StickerPicker } from '../components/StickerPicker';
import { toast } from '../components/Toast';
import { blockUser, unblockUser } from '../lib/actions';
import { api, errorText } from '../lib/api';
import { convTitle, others } from '../lib/conv';
import { dayLabel, isSameDay, lastSeen, linkify, timeOf } from '../lib/format';
import { downloadImage } from '../lib/share';
import { sendTyping } from '../lib/socket';
import { stickerUrl } from '../lib/stickers';
import { REACTIONS, type Conversation, type Message, type ReplyPreview, type Room, type User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { typingIn, useChat } from '../stores/chat';
import { FriendPicker, GroupAvatar } from './Chats';

/** What the composer is doing besides a new message: replying to one, or editing one of yours. */
type Draft = { mode: 'reply' | 'edit'; m: Message } | null;

export function ChatRoom({ conversationId }: { conversationId: number }) {
  const me = useAuth((s) => s.user)!;
  const nav = useNavigate();
  const conv = useChat((s) => s.conversations.find((c) => c.id === conversationId));
  const loaded = useChat((s) => s.conversationsLoaded);
  const thread = useChat((s) => s.threads[conversationId]);
  const { loadMessages, setActive, upsertConversation } = useChat.getState();
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft>(null);

  useEffect(() => {
    setActive(conversationId);
    setDraft(null);
    loadMessages(conversationId).catch(() => {});
    const onVis = () => document.visibilityState === 'visible' && useChat.getState().markRead(conversationId);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      setActive(null);
      document.removeEventListener('visibilitychange', onVis);
      sendTyping(conversationId, false);
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A chat not in our list yet (e.g. opened from a link): fetch it.
  useEffect(() => {
    if (!loaded || conv) return;
    api<{ conversation: Conversation }>(`/conversations/${conversationId}`)
      .then(({ conversation }) => upsertConversation(conversation))
      .catch(() => setMissing(true));
  }, [loaded, conv, conversationId, upsertConversation]);

  if (missing) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-semibold">This chat isn’t available.</p>
          <button className="btn btn-soft btn-sm mt-3" onClick={() => nav('/chats')}>
            Back to chats
          </button>
        </div>
      </div>
    );
  }
  if (!conv) return null;

  return (
    <div className="flex h-full flex-col bg-bg">
      <RoomHeader conv={conv} me={me} />
      <MessageList
        conv={conv}
        me={me}
        items={thread?.items ?? []}
        hasMore={thread?.hasMore ?? true}
        loading={!!thread?.loading}
        loaded={!!thread?.loaded}
        canWrite={!conv.block}
        onDraft={setDraft}
      />
      {conv.block ? <BlockedBar conv={conv} me={me} /> : <Composer conv={conv} me={me} draft={draft} onDraft={setDraft} />}
    </div>
  );
}

// ---------------------------------------------------------------- header

function RoomHeader({ conv, me }: { conv: Conversation; me: User }) {
  const nav = useNavigate();
  const chat = useChat();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const other = !conv.isGroup ? others(conv, me.id)[0] : undefined;
  const typers = typingIn(chat, conv.id);

  let status = conv.isGroup ? `${conv.members.length} members` : other ? lastSeen(other.lastSeenAt, other.online) : '';
  if (typers.length) {
    const name = conv.members.find((m) => m.id === typers[0])?.displayName;
    status = conv.isGroup && name ? `${name} is typing…` : 'typing…';
  }

  async function startBooth() {
    setBusy(true);
    try {
      const { room } = await api<{ room: Room }>('/rooms', { body: { conversationId: conv.id } });
      nav(`/booth/${room.code}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="safe-top z-10 shrink-0 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-2">
        <button className="icon-btn md:hidden" onClick={() => nav('/chats')} aria-label="Back">
          <Icon name="back" />
        </button>
        <Link to={other ? `/u/${other.username}` : '#'} onClick={(e) => conv.isGroup && (e.preventDefault(), setMenu(true))} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 md:pl-3">
          <GroupAvatar c={conv} meId={me.id} size={42} />
          <span className="min-w-0">
            <span className="block truncate font-bold">{convTitle(conv, me.id)}</span>
            <span className={`block truncate text-xs ${typers.length || other?.online ? 'font-semibold text-primary-strong' : 'text-muted'}`}>{status}</span>
          </span>
        </Link>
        <button className="icon-btn" onClick={startBooth} disabled={busy} aria-label="Start a photobooth together" title="Start a photobooth">
          <Icon name="camera" />
        </button>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Chat options">
          <Icon name="more" />
        </button>
      </div>
      <ChatMenu conv={conv} me={me} open={menu} onClose={() => setMenu(false)} />
    </header>
  );
}

function ChatMenu({ conv, me, open, onClose }: { conv: Conversation; me: User; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const upsert = useChat((s) => s.upsertConversation);
  const [title, setTitle] = useState(conv.title ?? '');
  const [inviting, setInviting] = useState<number[]>([]);
  const [mode, setMode] = useState<'main' | 'invite'>('main');

  const patch = async (body: Record<string, unknown>) => {
    try {
      const { conversation } = await api<{ conversation: Conversation }>(`/conversations/${conv.id}`, { method: 'PATCH', body });
      upsert(conversation);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  async function invite() {
    try {
      const { conversation } = await api<{ conversation: Conversation }>(`/conversations/${conv.id}/members`, { body: { userIds: inviting } });
      upsert(conversation);
      setInviting([]);
      setMode('main');
      toast('Invited 💌');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function toggleBlock() {
    const other = others(conv, me.id)[0];
    if (!other) return;
    const blocking = conv.block !== 'byMe';
    if (blocking && !confirm(`Block ${other.displayName}? They won’t be able to message you or see your profile.`)) return;
    try {
      if (blocking) await blockUser(other.id);
      else await unblockUser(other.id);
      upsert({ ...conv, block: blocking ? 'byMe' : null });
      toast(blocking ? `Blocked ${other.displayName}` : `Unblocked ${other.displayName}`);
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function leave() {
    if (!confirm('Leave this group?')) return;
    try {
      await api(`/conversations/${conv.id}/leave`, { method: 'POST' });
      useChat.getState().removeConversation(conv.id);
      nav('/chats');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <Sheet open={open} onClose={() => (setMode('main'), onClose())} title={mode === 'invite' ? 'Invite friends' : convTitle(conv, me.id)}>
      {mode === 'invite' ? (
        <>
          <FriendPicker
            selected={inviting}
            exclude={conv.members.map((m) => m.id)}
            onToggle={(u) => setInviting((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))}
          />
          <button className="btn btn-primary mt-3 w-full" disabled={!inviting.length} onClick={invite}>
            Invite {inviting.length || ''}
          </button>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {conv.isGroup && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) patch({ title: title.trim() });
              }}
            >
              <label className="field h-11 flex-1">
                <input placeholder="Group name" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <button className="btn btn-soft btn-sm h-11" disabled={!title.trim() || title.trim() === conv.title}>
                Rename
              </button>
            </form>
          )}
          <button className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold hover:bg-surface-2" onClick={() => patch({ muted: !conv.muted })}>
            <Icon name={conv.muted ? 'bell' : 'bellOff'} className="text-primary" />
            {conv.muted ? 'Unmute notifications' : 'Mute this chat'}
          </button>
          {conv.isGroup && (
            <button className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold hover:bg-surface-2" onClick={() => setMode('invite')}>
              <Icon name="userPlus" className="text-primary" /> Invite friends
            </button>
          )}
          <div>
            <p className="px-3 pb-1 text-xs font-bold tracking-wide text-faint uppercase">Members · {conv.members.length}</p>
            {conv.members.map((m) => (
              <Link key={m.id} to={m.id === me.id ? '/profile' : `/u/${m.username}`} className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-surface-2">
                <Avatar user={m} size={38} showOnline />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">
                    {m.displayName} {m.id === me.id && <span className="text-xs text-muted">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">@{m.username}</span>
                </span>
              </Link>
            ))}
          </div>
          {!conv.isGroup && conv.block !== 'byThem' && others(conv, me.id)[0] && (
            <button className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold text-danger hover:bg-surface-2" onClick={toggleBlock}>
              <Icon name="lock" /> {conv.block === 'byMe' ? 'Unblock' : 'Block'} {others(conv, me.id)[0].displayName}
            </button>
          )}
          {conv.isGroup && (
            <button className="btn btn-danger w-full" onClick={leave}>
              <Icon name="door" size={19} /> Leave group
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- messages

function MessageList({
  conv,
  me,
  items,
  hasMore,
  loading,
  loaded,
  canWrite,
  onDraft,
}: {
  conv: Conversation;
  me: User;
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  canWrite: boolean;
  onDraft: (d: Draft) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevLast = useRef<number | string | undefined>(undefined);
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const react = useChat((s) => s.react);
  const nearBottom = useRef(true);
  const prevFirst = useRef<number | undefined>(undefined);
  const prevHeight = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const [viewer, setViewer] = useState<Message | null>(null);
  const loadMessages = useChat((s) => s.loadMessages);
  const retry = useChat((s) => s.retry);
  const membersById = useMemo(() => new Map(conv.members.map((m) => [m.id, m])), [conv.members]);

  // Keep the reading position when older messages load; stick to the bottom only if already near it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = items[0]?.id;
    if (prevFirst.current !== undefined && first !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else if (items.length && (items[items.length - 1]?.clientId ?? items[items.length - 1]?.id) !== prevLast.current) {
      // Only a new message at the bottom counts — not an edit or reaction further up.
      setNewBelow(true);
    }
    prevLast.current = items[items.length - 1]?.clientId ?? items[items.length - 1]?.id;
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [items]);

  function onScroll() {
    const el = ref.current!;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom.current) setNewBelow(false);
    prevHeight.current = el.scrollHeight;
    if (el.scrollTop < 80 && hasMore && !loading && loaded) loadMessages(conv.id, true).catch(() => {});
  }

  /** Scrolls to the quoted message (if it's loaded) and flashes it. */
  function jumpTo(id: number) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return toast('That message is further up — scroll to load it');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('msg-flash');
    void el.offsetWidth;
    el.classList.add('msg-flash');
  }

  const lastMine = [...items].reverse().find((m) => m.senderId === me.id && m.kind !== 'system');
  const readers = lastMine && lastMine.id > 0
    ? conv.members.filter((m) => m.id !== me.id && conv.readStates[m.id] && new Date(conv.readStates[m.id]) >= new Date(lastMine.createdAt))
    : [];

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto px-3 py-3 md:px-6">
        {loaded && !hasMore && (
          <div className="anim-fade py-6 text-center">
            <GroupAvatar c={conv} meId={me.id} size={64} />
            <p className="mt-2 font-bold">{convTitle(conv, me.id)}</p>
            <p className="text-sm text-muted">This is the start of your chat ✨</p>
          </div>
        )}
        {loading && <div className="mx-auto my-3 h-5 w-5 anim-spin rounded-full border-2 border-primary-soft border-t-primary" />}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const grouped = !newDay && prev && prev.senderId === m.senderId && prev.kind !== 'system' && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          const sender = m.senderId ? membersById.get(m.senderId) : undefined;
          return (
            <Fragment key={m.clientId ?? m.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary-strong">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <MessageRow
                m={m}
                mine={m.senderId === me.id}
                sender={sender}
                showSender={conv.isGroup && !grouped}
                grouped={!!grouped}
                meId={me.id}
                membersById={membersById}
                canAct={canWrite}
                onOpenPhoto={() => setViewer(m)}
                onRetry={() => m.clientId && retry(conv.id, m.clientId)}
                onReply={() => onDraft({ mode: 'reply', m })}
                onActions={() => setActionsFor(m)}
                onReact={(emoji) => react(m, emoji).catch((e) => toast(errorText(e), 'error'))}
                onJump={jumpTo}
              />
              {m === lastMine && (
                <div className="mt-0.5 mr-1 text-right text-[11px] font-semibold text-faint">
                  {m.failed ? null : m.pending ? 'Sending…' : readers.length ? (conv.isGroup ? `Seen by ${readers.length}` : 'Seen') : 'Sent'}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {newBelow && (
        <button
          className="anim-pop absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg"
          onClick={() => {
            const el = ref.current!;
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          New messages ↓
        </button>
      )}
      <PhotoViewer m={viewer} onClose={() => setViewer(null)} />
      <MessageActions
        m={actionsFor}
        meId={me.id}
        onClose={() => setActionsFor(null)}
        onReply={(m) => onDraft({ mode: 'reply', m })}
        onEdit={(m) => onDraft({ mode: 'edit', m })}
      />
    </div>
  );
}

const SWIPE_REPLY_PX = 56;

function MessageRow({
  m,
  mine,
  sender,
  showSender,
  grouped,
  meId,
  membersById,
  canAct,
  onOpenPhoto,
  onRetry,
  onReply,
  onActions,
  onReact,
  onJump,
}: {
  m: Message;
  mine: boolean;
  sender?: User;
  showSender: boolean;
  grouped: boolean;
  meId: number;
  membersById: Map<number, User>;
  canAct: boolean;
  onOpenPhoto: () => void;
  onRetry: () => void;
  onReply: () => void;
  onActions: () => void;
  onReact: (emoji: string | null) => void;
  onJump: (id: number) => void;
}) {
  const [dx, setDx] = useState(0);
  const gesture = useRef<{ x: number; y: number; swiping: boolean; done: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);

  if (m.kind === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">{m.body}</span>
      </div>
    );
  }

  const deleted = !!m.deletedAt;
  const interactive = canAct && !deleted && m.id > 0;

  // Touch: swipe right to reply, hold to open actions. Mouse: right-click or the hover buttons.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!interactive || e.pointerType === 'mouse') return;
    const g: NonNullable<typeof gesture.current> = { x: e.clientX, y: e.clientY, swiping: false, done: false };
    g.timer = setTimeout(() => {
      g.done = true;
      navigator.vibrate?.(12);
      onActions();
    }, 450);
    gesture.current = g;
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.done) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) clearTimeout(g.timer);
      if (Math.abs(ddy) > 12 && Math.abs(ddy) > Math.abs(ddx)) {
        gesture.current = null; // they're scrolling the chat
        return;
      }
      if (ddx > 10 && ddx > Math.abs(ddy)) {
        g.swiping = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* the finger already lifted */
        }
      }
    }
    if (g.swiping) {
      const next = Math.max(0, Math.min(90, ddx * 0.7));
      if (next >= SWIPE_REPLY_PX && dx < SWIPE_REPLY_PX) navigator.vibrate?.(8);
      setDx(next);
    }
  }
  function onPointerEnd() {
    const g = gesture.current;
    if (g) clearTimeout(g.timer);
    if (g?.swiping && dx >= SWIPE_REPLY_PX) onReply();
    gesture.current = null;
    setDx(0);
  }

  const bubbleShape = mine ? 'rounded-br-md' : 'rounded-bl-md';
  const quote = m.replyTo ? (
    <ReplyQuote r={m.replyTo} meId={meId} membersById={membersById} mine={mine && m.kind === 'text'} onClick={() => onJump(m.replyTo!.id)} />
  ) : null;

  const bubble = deleted ? (
    <div className={`rounded-[20px] border border-dashed border-line px-3.5 py-2 text-[14px] text-faint italic ${bubbleShape}`}>
      🚫 {mine ? 'You deleted this message' : 'This message was deleted'}
    </div>
  ) : m.kind === 'text' ? (
    <div
      className={`max-w-full rounded-[20px] px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap shadow-sm ${
        mine ? 'rounded-br-md bg-[var(--bubble-me)] text-[var(--bubble-me-text)]' : 'rounded-bl-md bg-[var(--bubble-them)]'
      }`}
    >
      {quote}
      {linkify(m.body).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </div>
  ) : m.kind === 'sticker' ? (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {quote && <div className="max-w-[220px]">{quote}</div>}
      <img src={stickerUrl(m.meta.stickerId)} alt="sticker" className="anim-pop h-32 w-32 object-contain md:h-36 md:w-36" draggable={false} />
    </div>
  ) : m.kind === 'photo' ? (
    <button onClick={onOpenPhoto} className={`overflow-hidden rounded-[18px] bg-surface p-1.5 text-left shadow-sm ${bubbleShape}`}>
      {quote}
      <StripThumb photoId={m.meta.photoId} />
      {m.body && <p className="px-1.5 pt-1.5 pb-0.5 text-sm">{m.body}</p>}
    </button>
  ) : (
    <BoothInviteCard m={m} mine={mine} />
  );

  const reactions = Object.entries(m.reactions ?? {});
  const counts = new Map<string, number>();
  for (const [, e] of reactions) counts.set(e, (counts.get(e) ?? 0) + 1);
  const myReaction = m.reactions?.[meId];

  return (
    <div
      id={`msg-${m.id}`}
      className={`group relative flex touch-pan-y items-end rounded-2xl ${grouped ? 'mt-0.5' : 'mt-2.5'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => {
        if (!interactive) return;
        e.preventDefault();
        clearTimeout(gesture.current?.timer);
        gesture.current = null;
        onActions();
      }}
    >
      {/* Reply arrow revealed by the swipe */}
      {dx > 0 && (
        <span
          className="pointer-events-none absolute top-1/2 left-1 grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-primary-strong"
          style={{ opacity: Math.min(1, dx / SWIPE_REPLY_PX), transform: `translateY(-50%) scale(${dx >= SWIPE_REPLY_PX ? 1.1 : 0.8})` }}
        >
          <Icon name="back" size={16} />
        </span>
      )}
      <div
        className={`flex min-w-0 flex-1 items-end gap-2 ${mine ? 'justify-end' : ''} ${dx ? '' : 'transition-transform duration-200'}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      >
        {!mine && <span className="w-8 shrink-0">{!grouped && sender && <Link to={`/u/${sender.username}`}><Avatar user={sender} size={32} /></Link>}</span>}
        <div className={`flex max-w-[78%] flex-col md:max-w-[62%] ${mine ? 'items-end' : 'items-start'}`}>
          {showSender && !mine && sender && <span className="mb-0.5 ml-2 text-xs font-bold text-muted">{sender.displayName}</span>}
          <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
            <div
              className={`min-w-0 pointer-coarse:select-none [-webkit-touch-callout:none] ${m.pending ? 'opacity-70' : ''}`}
              onDoubleClick={() => interactive && onReact(myReaction === '❤️' ? null : '❤️')}
            >
              {bubble}
            </div>
            <span className="shrink-0 pb-0.5 text-[10.5px] text-faint">
              {m.editedAt && !deleted && <span className="mr-1 italic">edited</span>}
              {timeOf(m.createdAt)}
            </span>
            {interactive && (
              <span className="hidden shrink-0 items-center gap-0.5 self-center opacity-0 transition group-hover:opacity-100 pointer-fine:flex">
                <button className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={onReply} aria-label="Reply">
                  <Icon name="back" size={15} />
                </button>
                <button className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={onActions} aria-label="React and more">
                  <Icon name="smile" size={15} />
                </button>
              </span>
            )}
          </div>
          {counts.size > 0 && (
            <div className={`relative z-[1] -mt-1.5 flex gap-1 ${mine ? 'mr-10' : 'ml-2'}`}>
              {[...counts].map(([emoji, n]) => (
                <button
                  key={emoji}
                  className={`anim-pop flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[13px] leading-none shadow-sm ring-2 ring-bg ${
                    myReaction === emoji ? 'bg-primary-soft' : 'bg-surface'
                  }`}
                  onClick={() => interactive && onReact(myReaction === emoji ? null : emoji)}
                  title={reactions
                    .filter(([, e]) => e === emoji)
                    .map(([uid]) => (Number(uid) === meId ? 'You' : (membersById.get(Number(uid))?.displayName ?? 'Someone')))
                    .join(', ')}
                  aria-label={`${emoji} ${n}`}
                >
                  {emoji}
                  {n > 1 && <span className="text-[11px] font-bold text-muted">{n}</span>}
                </button>
              ))}
            </div>
          )}
          {m.failed && (
            <button onClick={onRetry} className="mt-0.5 text-xs font-bold text-danger">
              Failed to send · Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A shared strip; once its owner deletes it from Memories, a placeholder stays in the chat. */
function StripThumb({ photoId }: { photoId: number }) {
  const [gone, setGone] = useState(false);
  if (gone) {
    return <span className="block w-[200px] rounded-xl bg-surface-2 px-3 py-6 text-center text-sm text-faint">📸 This strip was deleted</span>;
  }
  return (
    <img
      src={`/api/photos/${photoId}`}
      alt="Photo strip"
      className="max-h-80 max-w-[220px] rounded-xl object-contain"
      loading="lazy"
      onError={() => setGone(true)}
    />
  );
}

/** The quoted message shown at the top of a reply; tapping it jumps to the original. */
function ReplyQuote({
  r,
  meId,
  membersById,
  mine,
  onClick,
}: {
  r: ReplyPreview;
  meId: number;
  membersById: Map<number, User>;
  mine: boolean;
  onClick: () => void;
}) {
  const who = r.senderId === meId ? 'You' : (membersById.get(r.senderId ?? 0)?.displayName ?? 'Someone');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`mb-1.5 block w-full min-w-[140px] rounded-xl border-l-[3px] px-2.5 py-1.5 text-left text-[13px] leading-snug ${
        mine ? 'border-white/70 bg-white/20' : 'border-primary bg-primary-soft/70 text-ink'
      }`}
    >
      <span className="block text-xs font-bold opacity-90">{who}</span>
      <span className="line-clamp-2 opacity-80">{replySnippet(r)}</span>
    </button>
  );
}

function replySnippet(r: { kind: string; body: string; deleted?: boolean; deletedAt?: string | null }) {
  if (r.deleted || r.deletedAt) return '🚫 Message deleted';
  if (r.kind === 'sticker') return '🦖 Sticker';
  if (r.kind === 'photo') return r.body ? `📸 ${r.body}` : '📸 Photo strip';
  if (r.kind === 'booth_invite') return '📷 Photobooth invite';
  return r.body;
}

/** Hold / right-click menu: quick reactions, reply, copy, edit and delete. */
function MessageActions({
  m,
  meId,
  onClose,
  onReply,
  onEdit,
}: {
  m: Message | null;
  meId: number;
  onClose: () => void;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
}) {
  if (!m) return null;
  const { react, deleteMessage } = useChat.getState();
  const mine = m.senderId === meId;
  const myReaction = m.reactions?.[meId];
  const run = (fn: () => Promise<unknown>) => () => {
    onClose();
    fn().catch((e) => toast(errorText(e), 'error'));
  };
  const row = 'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left font-bold hover:bg-surface-2';
  return (
    <Sheet open onClose={onClose}>
      <div className="grid gap-1 pt-2">
        <div className="mb-2 flex justify-between rounded-full bg-surface-2 p-1.5">
          {REACTIONS.map((e) => (
            <button
              key={e}
              className={`grid h-11 w-11 place-items-center rounded-full text-[26px] transition active:scale-90 ${myReaction === e ? 'scale-110 bg-primary-soft' : 'hover:bg-surface'}`}
              onClick={run(() => react(m, myReaction === e ? null : e))}
              aria-label={`React ${e}`}
              aria-pressed={myReaction === e}
            >
              {e}
            </button>
          ))}
        </div>
        <button className={row} onClick={() => (onClose(), onReply(m))}>
          <Icon name="back" className="text-primary" /> Reply
        </button>
        {m.kind === 'text' && (
          <button
            className={row}
            onClick={run(async () => {
              await navigator.clipboard.writeText(m.body);
              toast('Copied');
            })}
          >
            <Icon name="copy" className="text-primary" /> Copy text
          </button>
        )}
        {mine && m.kind === 'text' && (
          <button className={row} onClick={() => (onClose(), onEdit(m))}>
            <Icon name="edit" className="text-primary" /> Edit
          </button>
        )}
        {mine && (
          <button
            className={`${row} text-danger`}
            onClick={() => {
              if (confirm('Delete this message for everyone?')) run(() => deleteMessage(m))();
            }}
          >
            <Icon name="trash" /> Delete for everyone
          </button>
        )}
      </div>
    </Sheet>
  );
}

function BoothInviteCard({ m, mine }: { m: Message; mine: boolean }) {
  const expired = m.meta.expiresAt && new Date(m.meta.expiresAt) < new Date();
  return (
    <div className={`w-64 overflow-hidden rounded-[22px] bg-surface shadow-sm ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}>
      <div className="relative flex items-center gap-3 bg-gradient-to-br from-[#8fa1ea] to-[#6f84de] px-4 py-3 text-white">
        <img src={stickerUrl('dino-15')} alt="" className="h-14 w-14 object-contain drop-shadow" />
        <div>
          <p className="font-display text-lg leading-tight font-semibold">Photobooth</p>
          <p className="text-xs opacity-90">
            {m.meta.shots} shots · {m.meta.countdown}s countdown
          </p>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-muted">
          {mine ? 'You opened a booth.' : 'Join me in the booth!'} Code <b className="tracking-widest text-ink">{m.meta.code}</b>
        </p>
        {expired ? (
          <p className="mt-2 text-center text-sm font-bold text-faint">This booth has ended</p>
        ) : (
          <Link to={`/booth/${m.meta.code}`} className="btn btn-primary btn-sm mt-2 w-full">
            <Icon name="camera" size={18} /> Join booth
          </Link>
        )}
      </div>
    </div>
  );
}

function PhotoViewer({ m, onClose }: { m: Message | null; onClose: () => void }) {
  async function download() {
    if (!m) return;
    const blob = await fetch(`/api/photos/${m.meta.photoId}`, { credentials: 'include' }).then((r) => r.blob());
    await downloadImage(blob, `nivotalk-strip-${m.meta.photoId}.jpg`);
  }
  return (
    <Sheet open={!!m} onClose={onClose} title="Photo strip">
      {m && (
        <div className="grid grid-cols-1 gap-3">
          <img src={`/api/photos/${m.meta.photoId}`} alt="Photo strip" className="mx-auto max-h-[62dvh] rounded-2xl object-contain shadow" />
          {m.body && <p className="text-center">{m.body}</p>}
          <button className="btn btn-soft w-full" onClick={download}>
            <Icon name="download" size={19} /> Save
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- composer

/** Replaces the composer in a direct chat where one of you blocked the other. */
function BlockedBar({ conv, me }: { conv: Conversation; me: User }) {
  const other = others(conv, me.id)[0];
  const [busy, setBusy] = useState(false);
  return (
    <div className="safe-bottom shrink-0 border-t border-line bg-surface px-4 py-3 text-center text-sm">
      {conv.block === 'byMe' ? (
        <>
          <p className="font-semibold text-muted">You blocked {other?.displayName ?? 'this person'}.</p>
          <button
            className="btn btn-soft btn-sm mt-2"
            disabled={busy || !other}
            onClick={async () => {
              setBusy(true);
              try {
                await unblockUser(other!.id);
                useChat.getState().upsertConversation({ ...conv, block: null });
              } catch (e) {
                toast(errorText(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Unblock
          </button>
        </>
      ) : (
        <p className="font-semibold text-muted">You can’t reply to this chat.</p>
      )}
    </div>
  );
}

function Composer({ conv, me, draft, onDraft }: { conv: Conversation; me: User; draft: Draft; onDraft: (d: Draft) => void }) {
  const send = useChat((s) => s.send);
  const editMessage = useChat((s) => s.editMessage);
  const [text, setText] = useState('');
  const [stickers, setStickers] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const savedText = useRef('');

  // Editing fills the box with the message; finishing or cancelling brings back what you were typing.
  useEffect(() => {
    if (draft?.mode === 'edit') {
      savedText.current = text;
      setText(draft.m.body);
    }
    if (draft) requestAnimationFrame(() => ta.current?.focus());
  }, [draft?.m.id, draft?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearDraft() {
    if (draft?.mode === 'edit') setText(savedText.current);
    onDraft(null);
  }

  const replyTo = draft?.mode === 'reply' ? draft.m : undefined;
  const replyWho = draft && (draft.m.senderId === me.id ? 'yourself' : (conv.members.find((u) => u.id === draft.m.senderId)?.displayName ?? 'Someone'));

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  function submit() {
    const body = text.trim();
    if (!body) return;
    if (draft?.mode === 'edit') {
      const m = draft.m;
      setText(savedText.current);
      onDraft(null);
      if (body !== m.body) editMessage(m, body.slice(0, 4000)).catch((e) => toast(errorText(e), 'error'));
      return;
    }
    setText('');
    sendTyping(conv.id, false);
    send(conv.id, { kind: 'text', body: body.slice(0, 4000) }, replyTo);
    if (draft) onDraft(null);
    ta.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on desktop; on touch keyboards Enter makes a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && draft) clearDraft();
  }

  return (
    <div className="safe-bottom shrink-0 border-t border-line bg-surface">
      {draft && (
        <div className="anim-rise flex items-center gap-2 border-b border-line px-3 py-2 md:px-5">
          <Icon name={draft.mode === 'edit' ? 'edit' : 'back'} size={18} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1 border-l-[3px] border-primary pl-2.5">
            <p className="text-xs font-bold text-primary-strong">{draft.mode === 'edit' ? 'Editing message' : `Replying to ${replyWho}`}</p>
            <p className="truncate text-sm text-muted">{replySnippet(draft.m)}</p>
          </div>
          <button className="icon-btn shrink-0" onClick={clearDraft} aria-label={draft.mode === 'edit' ? 'Cancel editing' : 'Cancel reply'}>
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2 py-2 md:px-4">
        <button
          className={`icon-btn shrink-0 ${stickers ? '!bg-primary-soft !text-primary-strong' : ''}`}
          onClick={() => setStickers((s) => !s)}
          aria-label="Stickers"
          aria-pressed={stickers}
        >
          <Icon name="smile" />
        </button>
        <textarea
          ref={ta}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder="Message"
          onChange={(e) => {
            setText(e.target.value);
            sendTyping(conv.id, e.target.value.length > 0);
          }}
          onKeyDown={onKey}
          onFocus={() => setStickers(false)}
          className="scroll-thin min-h-[42px] flex-1 resize-none rounded-[22px] bg-surface-2 px-4 py-2.5 text-[15px] leading-snug outline-none focus:ring-2 focus:ring-primary-soft"
        />
        <button
          className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full transition ${text.trim() ? 'bg-primary text-white shadow-md' : 'bg-primary-soft text-faint'}`}
          onClick={submit}
          disabled={!text.trim()}
          aria-label={draft?.mode === 'edit' ? 'Save edit' : 'Send'}
        >
          <Icon name={draft?.mode === 'edit' ? 'check' : 'send'} size={20} />
        </button>
      </div>
      {stickers && (
        <div className="anim-rise border-t border-line">
          <StickerPicker
            onPick={(id) => {
              send(conv.id, { kind: 'sticker', meta: { stickerId: id } }, replyTo);
              if (replyTo) onDraft(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
