import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar } from '../components/Avatar';
import { CoinButton } from '../components/CoinStore';
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
import { useCoins } from '../stores/coins';
import { NewsBanner } from '../components/News';
import { prepareImage } from '../lib/image';
import { unseenNews, useNews } from '../stores/news';

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

/** Pick your own Chats background for coins, or go back to the plain one. */
function ChatsBgSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.user)!;
  const cost = useCoins((s) => s.prices.chatsBg);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await prepareImage(file, { max: 1440, quality: 0.82 });
      const r = await api<{ coins: number; chatsBgUrl: string }>('/users/me/chats-bg', { method: 'PUT', raw: blob });
      useCoins.getState().setBalance({ coins: r.coins });
      useAuth.getState().setUser({ ...me, chatsBgUrl: r.chatsBgUrl });
      toast('New Chats background 🌸');
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api('/users/me/chats-bg', { method: 'DELETE' });
      useAuth.getState().setUser({ ...me, chatsBgUrl: null });
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Chats background">
      <div
        className="grid h-40 place-items-center overflow-hidden rounded-[22px] border border-line bg-bg text-sm font-bold text-muted"
        style={me.chatsBgUrl || me.coverUrl ? { background: `url(${me.chatsBgUrl || me.coverUrl}) center / cover` } : undefined}
      >
        {!me.chatsBgUrl && !me.coverUrl && 'Plain background'}
      </div>
      <p className="mt-3 text-sm text-muted">
        {me.chatsBgUrl
          ? 'You’re using your own Chats photo. Only you see it.'
          : me.coverUrl
            ? 'Your profile background shows here for free. Want a different photo just for Chats?'
            : 'Set a profile background to see it here for free, or pick a photo just for Chats.'}
      </p>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <button className="btn btn-primary mt-3 w-full" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="image" size={19} /> {busy ? 'Saving…' : `Choose a photo · 🪙 ${cost}`}
      </button>
      {me.chatsBgUrl && (
        <button className="btn btn-soft mt-2 w-full" disabled={busy} onClick={reset}>
          {me.coverUrl ? 'Use my profile background (free)' : 'Back to plain (free)'}
        </button>
      )}
    </Sheet>
  );
}

/** Opens NivoTalk news; the dot means there's something you haven't read. */
function NewsButton() {
  const show = useNews((s) => s.show);
  const unseen = useNews((s) => unseenNews(s).length);
  return (
    <button className="icon-btn relative" onClick={show} aria-label={unseen ? `NivoTalk news, ${unseen} new` : 'NivoTalk news'}>
      <Icon name="bell" />
      {unseen > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface" />}
    </button>
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
  const [bgOpen, setBgOpen] = useState(false);
  const anyTyping = Object.values(chatState.typing).some((t) => Object.keys(t).length > 0);
  const now = useTick(anyTyping);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return conversations;
    return conversations.filter((c) => convTitle(c, me.id).toLowerCase().includes(s));
  }, [conversations, q, me.id]);

  // Your profile background shows behind your chats (or the one you bought just for Chats), softened so the list stays readable.
  const bgUrl = me.chatsBgUrl || me.coverUrl;
  const bgStyle = bgUrl
    ? {
        background: `linear-gradient(color-mix(in srgb, var(--bg) 45%, transparent), color-mix(in srgb, var(--bg) 78%, transparent)), url(${bgUrl}) center / cover`,
      }
    : undefined;

  return (
    <div className="flex h-full flex-col bg-bg md:bg-surface" style={bgStyle}>
      <header className="safe-top px-5 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold">Chats</h1>
          <div className="flex items-center gap-1">
            <CoinButton />
            <NewsButton />
            <button className="icon-btn" onClick={() => setNewGroup(true)} aria-label="New group chat">
              <Icon name="group" />
            </button>
            <button className="icon-btn" onClick={() => setBgOpen(true)} aria-label="Chats background" title="Change background">
              <Icon name="palette" />
            </button>
          </div>
        </div>
        <label className="field mt-3 h-11 bg-surface/90">
          <Icon name="search" size={18} className="text-faint" />
          <input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </header>
      <ChatsBgSheet open={bgOpen} onClose={() => setBgOpen(false)} />

      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-28 md:pb-4">
        <NewsBanner />
        <GroupInvites />
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
              // Frosted white cards, so the Chats background shows softly through.
              className={`anim-rise mb-2 flex items-center gap-3 rounded-[22px] px-3 py-3 shadow-[var(--shadow-sm)] ring-1 ring-white/60 backdrop-blur-md transition ${
                activeId === c.id ? 'bg-primary-soft/90' : 'bg-surface/60 hover:bg-surface/80'
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

/** Group invitations: join with a coin, or decline. */
function GroupInvites() {
  const invites = useChat((s) => s.invites);
  const joinCost = useCoins((s) => s.prices.groupJoin);
  const nav = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  if (!invites.length) return null;

  async function respond(id: number, join: boolean) {
    setBusy(id);
    try {
      if (join) {
        const r = await api<{ coins: number; conversation: Conversation }>(`/conversations/${id}/join`, { method: 'POST' });
        useCoins.getState().setBalance({ coins: r.coins });
        useChat.getState().upsertConversation(r.conversation);
        nav(`/chats/${id}`);
      } else {
        await api(`/conversations/${id}/decline`, { method: 'POST' });
      }
      await useChat.getState().loadInvites();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-2 grid gap-2 px-1">
      {invites.map((inv) => (
        <div key={inv.conversationId} className="anim-rise flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-primary-soft/70 px-3 py-2.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-primary">
            <Icon name="group" />
          </span>
          <div className="min-w-0 flex-1 basis-[55%]">
            <p className="truncate text-sm font-bold">{inv.title || 'Group chat'}</p>
            <p className="truncate text-xs text-muted">
              {inv.invitedBy?.displayName ?? 'Someone'} invited you · {inv.memberCount} {inv.memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          {/* The buttons drop under the name on narrow phones. */}
          <div className="ml-auto flex shrink-0 gap-2">
            <button className="btn btn-ghost btn-sm" disabled={busy === inv.conversationId} onClick={() => respond(inv.conversationId, false)}>
              Decline
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy === inv.conversationId} onClick={() => respond(inv.conversationId, true)}>
              Join · 🪙 {joinCost}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const upsert = useChat((s) => s.upsertConversation);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const groupCost = useCoins((s) => s.prices.groupCreate);
  const joinCost = useCoins((s) => s.prices.groupJoin);

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
        Create group · 🪙 {groupCost}
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        Friends you pick get an invitation and join for 🪙 {joinCost}.
      </p>
    </Sheet>
  );
}
