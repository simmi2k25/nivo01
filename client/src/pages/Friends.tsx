import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { addFriend, openDirectChat, removeFriend, setFavorite, startBoothWith } from '../lib/actions';
import { api, errorText } from '../lib/api';
import { lastSeen } from '../lib/format';
import { stickerUrl } from '../lib/stickers';
import type { Friend, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';

type SearchUser = User & { isFriend: boolean };

export function FriendsPage() {
  const me = useAuth((s) => s.user)!;
  const { friends, addedMe, friendsLoaded } = useChat();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchUser[] | null>(null);
  const [picked, setPicked] = useState<Friend | null>(null);

  // Search people as you type (debounced).
  useEffect(() => {
    const s = q.trim().replace(/^@/, '');
    if (!s) return setResults(null);
    const c = new AbortController();
    const t = setTimeout(() => {
      api<{ users: SearchUser[] }>(`/users/search?q=${encodeURIComponent(s)}`, { signal: c.signal })
        .then((r) => setResults(r.users))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);

  async function addByUsername(e: FormEvent) {
    e.preventDefault();
    const username = q.trim().replace(/^@/, '').toLowerCase();
    if (!username) return;
    try {
      const f = await addFriend({ username });
      toast(`Added ${f.displayName} 💕`);
      setQ('');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const online = useMemo(() => friends.filter((f) => f.online).length, [friends]);
  const favorites = friends.filter((f) => f.favorite);
  const rest = friends.filter((f) => !f.favorite);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="safe-top px-5 pt-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[28px] font-bold">Friends</h1>
            <p className="text-sm text-muted">
              {friends.length} friends · <span className="font-semibold text-[var(--success)]">{online} online</span>
            </p>
          </div>
          <Link to="/profile?qr=1" className="btn btn-soft btn-sm">
            <Icon name="qr" size={18} /> My QR
          </Link>
        </div>
        <form onSubmit={addByUsername} className="mt-3 flex gap-2">
          <label className="field h-11 flex-1">
            <Icon name="search" size={18} className="text-faint" />
            <input placeholder="Add or search by username" value={q} autoCapitalize="none" onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" onClick={() => setQ('')} className="text-faint" aria-label="Clear">
                <Icon name="x" size={18} />
              </button>
            )}
          </label>
          <button className="btn btn-primary btn-sm h-11" disabled={!q.trim()}>
            <Icon name="userPlus" size={18} /> Add
          </button>
        </form>
      </header>

      <div className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-28 md:pb-6">
        {results && (
          <Section title="People">
            {results.length === 0 && <p className="px-3 py-4 text-sm text-muted">No one found with that name.</p>}
            {results.map((u) => (
              <PersonRow key={u.id} user={u} subtitle={`@${u.username}`}>
                {u.isFriend ? (
                  <span className="text-xs font-bold text-faint">Friend</span>
                ) : (
                  <AddButton user={u} onAdded={() => setResults((r) => r?.map((x) => (x.id === u.id ? { ...x, isFriend: true } : x)) ?? null)} />
                )}
              </PersonRow>
            ))}
          </Section>
        )}

        {!results && (
          <>
            {addedMe.length > 0 && (
              <Section title={`Added you · ${addedMe.length}`}>
                {addedMe.map((u) => (
                  <PersonRow key={u.id} user={u} subtitle={`@${u.username}`}>
                    <AddButton user={u} label="Add back" />
                  </PersonRow>
                ))}
              </Section>
            )}
            {favorites.length > 0 && (
              <Section title="Favourites">
                {favorites.map((f) => (
                  <FriendRow key={f.id} f={f} onPick={() => setPicked(f)} />
                ))}
              </Section>
            )}
            <Section title={favorites.length ? 'Everyone' : 'Your friends'}>
              {friendsLoaded && friends.length === 0 && (
                <div className="anim-rise px-6 py-10 text-center">
                  <img src={stickerUrl('pomi-02')} alt="" className="anim-float mx-auto h-28 w-28 object-contain" />
                  <p className="mt-2 font-semibold">No friends yet</p>
                  <p className="text-sm text-muted">
                    Add someone by their username, or share your QR ID. You’re <b>@{me.username}</b>.
                  </p>
                </div>
              )}
              {rest.map((f) => (
                <FriendRow key={f.id} f={f} onPick={() => setPicked(f)} />
              ))}
            </Section>
          </>
        )}
      </div>
      <FriendSheet f={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3">
      <h2 className="px-3 pb-1 text-xs font-bold tracking-wide text-faint uppercase">{title}</h2>
      <div className="grid grid-cols-1 gap-0.5">{children}</div>
    </section>
  );
}

function PersonRow({ user, subtitle, children, onClick }: { user: User; subtitle: string; children?: React.ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <Avatar user={user} size={48} showOnline />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-bold">{user.displayName}</span>
        <span className="block truncate text-xs text-muted">{subtitle}</span>
      </span>
    </>
  );
  return (
    <div className="anim-rise flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-surface-2">
      {onClick ? (
        <button className="flex min-w-0 flex-1 items-center gap-3" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <Link to={`/u/${user.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          {inner}
        </Link>
      )}
      {children}
    </div>
  );
}

function FriendRow({ f, onPick }: { f: Friend; onPick: () => void }) {
  return (
    <PersonRow user={f} onClick={onPick} subtitle={f.bio || (f.online ? 'Online' : lastSeen(f.lastSeenAt, false))}>
      {f.mutual ? null : <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary-strong">Pending</span>}
      <button
        className={`icon-btn h-9 w-9 ${f.favorite ? '!text-[#f2b33d]' : ''}`}
        onClick={() => setFavorite(f.id, !f.favorite).catch((e) => toast(errorText(e), 'error'))}
        aria-label={f.favorite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <Icon name="star" size={19} fill={f.favorite ? 'currentColor' : 'none'} />
      </button>
    </PersonRow>
  );
}

function AddButton({ user, label = 'Add', onAdded }: { user: User; label?: string; onAdded?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-soft btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await addFriend({ userId: user.id });
          toast(`Added ${user.displayName} 💕`);
          onAdded?.();
        } catch (e) {
          toast(errorText(e), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="userPlus" size={16} /> {label}
    </button>
  );
}

function FriendSheet({ f, onClose }: { f: Friend | null; onClose: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!f} onClose={onClose}>
      {f && (
        <div className="grid justify-items-center gap-1 pt-3 text-center">
          <Avatar user={f} size={88} showOnline />
          <h2 className="mt-2 text-xl font-semibold">{f.displayName}</h2>
          <p className="text-sm text-muted">
            @{f.username} · {lastSeen(f.lastSeenAt, f.online)}
          </p>
          {f.bio && <p className="mt-1 max-w-xs text-sm">{f.bio}</p>}
          {!f.mutual && <p className="mt-1 text-xs font-semibold text-faint">They haven’t added you back yet</p>}
          <div className="mt-4 grid w-full grid-cols-3 gap-2">
            <SheetAction icon="chat" label="Chat" disabled={busy} onClick={run(async () => nav(`/chats/${(await openDirectChat(f.id)).id}`))} />
            <SheetAction icon="camera" label="Photobooth" disabled={busy} onClick={run(async () => nav(`/booth/${(await startBoothWith(f.id)).code}`))} />
            <SheetAction icon="user" label="Profile" onClick={() => nav(`/u/${f.username}`)} />
          </div>
          <button
            className="btn btn-ghost btn-sm mt-3 !text-danger"
            disabled={busy}
            onClick={run(async () => {
              if (!confirm(`Remove ${f.displayName} from your friends?`)) return;
              await removeFriend(f.id);
              onClose();
            })}
          >
            Remove friend
          </button>
        </div>
      )}
    </Sheet>
  );
}

function SheetAction({ icon, label, onClick, disabled }: { icon: 'chat' | 'camera' | 'user'; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1.5 rounded-2xl bg-primary-soft py-3 text-sm font-bold text-primary-strong transition active:scale-95">
      <Icon name={icon} />
      {label}
    </button>
  );
}
