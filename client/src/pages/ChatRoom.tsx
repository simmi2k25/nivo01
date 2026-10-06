import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { StickerPicker } from '../components/StickerPicker';
import { toast } from '../components/Toast';
import { api, errorText } from '../lib/api';
import { convTitle, others } from '../lib/conv';
import { dayLabel, isSameDay, lastSeen, linkify, timeOf } from '../lib/format';
import { downloadImage } from '../lib/share';
import { sendTyping } from '../lib/socket';
import { stickerUrl } from '../lib/stickers';
import type { Conversation, Message, Room, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { typingIn, useChat } from '../stores/chat';
import { FriendPicker, GroupAvatar } from './Chats';

export function ChatRoom({ conversationId }: { conversationId: number }) {
  const me = useAuth((s) => s.user)!;
  const nav = useNavigate();
  const conv = useChat((s) => s.conversations.find((c) => c.id === conversationId));
  const loaded = useChat((s) => s.conversationsLoaded);
  const thread = useChat((s) => s.threads[conversationId]);
  const { loadMessages, setActive, upsertConversation } = useChat.getState();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setActive(conversationId);
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
      <MessageList conv={conv} me={me} items={thread?.items ?? []} hasMore={thread?.hasMore ?? true} loading={!!thread?.loading} loaded={!!thread?.loaded} />
      <Composer conv={conv} />
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
        <div className="grid gap-3">
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

function MessageList({ conv, me, items, hasMore, loading, loaded }: { conv: Conversation; me: User; items: Message[]; hasMore: boolean; loading: boolean; loaded: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
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
    } else if (items.length) {
      setNewBelow(true);
    }
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
                onOpenPhoto={() => setViewer(m)}
                onRetry={() => m.clientId && retry(conv.id, m.clientId)}
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
    </div>
  );
}

function MessageRow({
  m,
  mine,
  sender,
  showSender,
  grouped,
  onOpenPhoto,
  onRetry,
}: {
  m: Message;
  mine: boolean;
  sender?: User;
  showSender: boolean;
  grouped: boolean;
  onOpenPhoto: () => void;
  onRetry: () => void;
}) {
  if (m.kind === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">{m.body}</span>
      </div>
    );
  }

  const bubble =
    m.kind === 'text' ? (
      <div
        className={`max-w-full rounded-[20px] px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap shadow-sm ${
          mine ? 'rounded-br-md bg-[var(--bubble-me)] text-[var(--bubble-me-text)]' : 'rounded-bl-md bg-[var(--bubble-them)]'
        }`}
      >
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
      <img src={stickerUrl(m.meta.stickerId)} alt="sticker" className="anim-pop h-32 w-32 object-contain md:h-36 md:w-36" draggable={false} />
    ) : m.kind === 'photo' ? (
      <button onClick={onOpenPhoto} className={`overflow-hidden rounded-[18px] bg-surface p-1.5 text-left shadow-sm ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}>
        <img src={`/api/photos/${m.meta.photoId}`} alt="Photo strip" className="max-h-80 max-w-[220px] rounded-xl object-contain" loading="lazy" />
        {m.body && <p className="px-1.5 pt-1.5 pb-0.5 text-sm">{m.body}</p>}
      </button>
    ) : (
      <BoothInviteCard m={m} mine={mine} />
    );

  return (
    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : ''} ${grouped ? 'mt-0.5' : 'mt-2.5'}`}>
      {!mine && <span className="w-8 shrink-0">{!grouped && sender && <Link to={`/u/${sender.username}`}><Avatar user={sender} size={32} /></Link>}</span>}
      <div className={`flex max-w-[78%] flex-col md:max-w-[62%] ${mine ? 'items-end' : 'items-start'}`}>
        {showSender && !mine && sender && <span className="mb-0.5 ml-2 text-xs font-bold text-muted">{sender.displayName}</span>}
        <div className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
          <div className={m.pending ? 'opacity-70' : ''}>{bubble}</div>
          <span className="shrink-0 pb-0.5 text-[10.5px] text-faint">{timeOf(m.createdAt)}</span>
        </div>
        {m.failed && (
          <button onClick={onRetry} className="mt-0.5 text-xs font-bold text-danger">
            Failed to send · Retry
          </button>
        )}
      </div>
    </div>
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
        <div className="grid gap-3">
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

function Composer({ conv }: { conv: Conversation }) {
  const send = useChat((s) => s.send);
  const [text, setText] = useState('');
  const [stickers, setStickers] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    sendTyping(conv.id, false);
    send(conv.id, { kind: 'text', body: body.slice(0, 4000) });
    ta.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on desktop; on touch keyboards Enter makes a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="safe-bottom shrink-0 border-t border-line bg-surface">
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
          aria-label="Send"
        >
          <Icon name="send" size={20} />
        </button>
      </div>
      {stickers && (
        <div className="anim-rise border-t border-line">
          <StickerPicker onPick={(id) => send(conv.id, { kind: 'sticker', meta: { stickerId: id } })} />
        </div>
      )}
    </div>
  );
}
