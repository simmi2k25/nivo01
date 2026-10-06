import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, errorText } from '../lib/api';
import { convTitle, others, preview } from '../lib/conv';
import { listStamp } from '../lib/format';
import { stickerUrl } from '../lib/stickers';
import type { Conversation, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { typingIn, useChat } from '../stores/chat';
import { ChatRoom } from './ChatRoom';

export function ChatsPage() {
  const { id } = useParams();
  const convId = id ? Number(id) : null;

  return (
    <div className="flex h-full">
      <section className={`h-full w-full shrink-0 border-line md:w-[340px] md:border-r lg:w-[380px] ${convId ? 'hidden md:block' : ''}`}>
        <ConversationList activeId={convId} />
      </section>
      <section className={`h-full min-w-0 flex-1 ${convId ? '' : 'hidden md:block'}`}>
        {convId ? <ChatRoom key={convId} conversationId={convId} /> : <EmptyChat />}
      </section>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="anim-rise">
        <img src={stickerUrl('chatty-05')} alt="" className="anim-float mx-auto h-32 w-32 object-contain" />
        <h2 className="mt-3 text-xl font-semibold">Pick a chat</h2>
        <p className="mt-1 text-muted">Say hi, send a sticker, or start a photobooth together.</p>
      </div>
    </div>
  );
}

export function GroupAvatar({ c, meId, size = 52 }: { c: Conversation; meId: number; size?: number }) {
  const o = others(c, meId);
  if (!c.isGroup) return o[0] ? <Avatar user={o[0]} size={size} showOnline /> : <Avatar user={c.members[0]} size={size} />;
  const two = o.slice(0, 2);
  const s = Math.round(size * 0.68);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {two[1] && (
        <span className="absolute top-0 right-0">
          <Avatar user={two[1]} size={s} />
        </span>
      )}
      {two[0] && (
        <span className="absolute bottom-0 left-0 rounded-full ring-[2.5px] ring-surface">
          <Avatar user={two[0]} size={s} />
        </span>
      )}
    </span>
  );
}

function useTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function ConversationList({ activeId }: { activeId: number | null }) {
  const me = useAuth((s) => s.user)!;
  const { conversations, conversationsLoaded } = useChat();
  const chatState = useChat();
  const [q, setQ] = useState('');
  const [newGroup, setNewGroup] = useState(false);
  const anyTyping = Object.values(chatState.typing).some((t) => Object.keys(t).length > 0);
  const now = useTick(anyTyping);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return conversations;
    return conversations.filter((c) => convTitle(c, me.id).toLowerCase().includes(s));
  }, [conversations, q, me.id]);

  return (
    <div className="flex h-full flex-col bg-bg md:bg-surface">
      <header className="safe-top px-5 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold">Chats</h1>
          <div className="flex gap-1">
            <button className="icon-btn" onClick={() => setNewGroup(true)} aria-label="New group chat">
              <Icon name="group" />
            </button>
            <Link to="/friends" className="icon-btn" aria-label="Find friends">
              <Icon name="userPlus" />
            </Link>
          </div>
        </div>
        <label className="field mt-3 h-11">
          <Icon name="search" size={18} className="text-faint" />
          <input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </header>

      <div className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-28 md:pb-4">
        {!conversationsLoaded && <ListSkeleton />}
        {conversationsLoaded && conversations.length === 0 && (
          <div className="anim-rise px-6 py-12 text-center">
            <img src={stickerUrl('dino-01')} alt="" className="anim-float mx-auto h-28 w-28 object-contain" />
            <h2 className="mt-2 text-lg font-semibold">No chats yet</h2>
            <p className="mt-1 text-sm text-muted">Add a friend by username and say hi!</p>
            <Link to="/friends" className="btn btn-primary btn-sm mt-4">
              <Icon name="userPlus" size={18} /> Find friends
            </Link>
          </div>
        )}
        {list.map((c, i) => {
          const typers = typingIn(chatState, c.id, now);
          const typerName = c.members.find((m) => m.id === typers[0])?.displayName;
          return (
            <Link
              key={c.id}
              to={`/chats/${c.id}`}
              className={`anim-rise flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                activeId === c.id ? 'bg-primary-soft' : 'hover:bg-surface-2'
              }`}
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <GroupAvatar c={c} meId={me.id} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-bold">{convTitle(c, me.id)}</span>
                  {c.isGroup && <span className="text-xs font-bold text-faint">{c.members.length}</span>}
                  {c.muted && <Icon name="bellOff" size={14} className="shrink-0 text-faint" />}
                  <span className="ml-auto shrink-0 text-xs text-faint">{c.lastMessage ? listStamp(c.lastMessage.createdAt) : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  {typers.length ? (
                    <span className="truncate text-sm font-semibold text-primary-strong">
                      {c.isGroup && typerName ? `${typerName} is typing` : 'typing'}
                      <span className="typing-dots ml-1">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  ) : (
                    <span className={`truncate text-sm ${c.unread ? 'font-semibold text-ink' : 'text-muted'}`}>
                      {preview(c.lastMessage, me.id, c.members)}
                    </span>
                  )}
                  {c.unread > 0 && (
                    <span className={`badge-count ml-auto shrink-0 ${c.muted ? '!bg-faint' : ''}`}>{c.unread > 99 ? '99+' : c.unread}</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-1 px-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5" style={{ opacity: 1 - i * 0.16 }}>
          <span className="h-[52px] w-[52px] rounded-full bg-primary-soft" />
          <span className="grid flex-1 gap-2">
            <span className="h-3.5 w-1/2 rounded-full bg-primary-soft" />
            <span className="h-3 w-3/4 rounded-full bg-primary-soft/70" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Pick friends from your list (used for new groups and inviting to groups). */
export function FriendPicker({ selected, onToggle, exclude = [] }: { selected: number[]; onToggle: (u: User) => void; exclude?: number[] }) {
  const friends = useChat((s) => s.friends);
  const [q, setQ] = useState('');
  const list = friends.filter(
    (f) => !exclude.includes(f.id) && (f.displayName.toLowerCase().includes(q.toLowerCase()) || f.username.includes(q.toLowerCase())),
  );
  return (
    <div>
      <label className="field h-11">
        <Icon name="search" size={18} className="text-faint" />
        <input placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="mt-2 grid grid-cols-1 gap-0.5">
        {list.length === 0 && <p className="py-6 text-center text-sm text-muted">No friends to show — add some first!</p>}
        {list.map((f) => {
          const on = selected.includes(f.id);
          return (
            <button key={f.id} type="button" onClick={() => onToggle(f)} className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-2">
              <Avatar user={f} size={42} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{f.displayName}</span>
                <span className="block truncate text-xs text-muted">@{f.username}</span>
              </span>
              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 transition ${on ? 'border-primary bg-primary text-white' : 'border-line'}`}>
                {on && <Icon name="check" size={14} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const upsert = useChat((s) => s.upsertConversation);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const { conversation } = await api<{ conversation: Conversation }>('/conversations/group', {
        body: { title: title.trim() || undefined, memberIds: selected },
      });
      upsert(conversation);
      onClose();
      setSelected([]);
      setTitle('');
      nav(`/chats/${conversation.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New group">
      <label className="field">
        <Icon name="group" size={19} className="text-faint" />
        <input placeholder="Group name (optional)" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="mt-3">
        <FriendPicker selected={selected} onToggle={(u) => setSelected((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id].slice(0, 29)))} />
      </div>
      <button className="btn btn-primary sticky bottom-0 mt-3 w-full" disabled={!selected.length || busy} onClick={create}>
        Create group{selected.length ? ` (${selected.length + 1})` : ''}
      </button>
    </Sheet>
  );
}
