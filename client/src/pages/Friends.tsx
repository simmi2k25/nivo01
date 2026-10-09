import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar';
import { CoinButton } from '../components/CoinStore';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { addFriend, openDirectChat, removeFriend, setFavorite, startBoothWith } from '../lib/actions';
import { api, errorText } from '../lib/api';
import { lastSeen, listStamp } from '../lib/format';
import { BUDDY_TINT, stickerUrl } from '../lib/stickers';
import type { Buddy, Friend, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { StatusRing } from '../components/Status';
import { StoryCard } from '../components/StoryCard';
import { groupFor, useStatus } from '../stores/status';

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

  const groups = useStatus((s) => s.groups);
  const mine = groupFor(groups, me.id);
  // New statuses first, then seen ones, then favourites, then whoever's online.
  const rank = (f: Friend) => {
    const g = groupFor(groups, f.id);
    return g ? (g.allSeen ? 1 : 2) : 0;
  };
  const sorted = [...friends].sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.online) - Number(a.online));
  // The story row only shows friends with a status up right now; new ones first.
  const stories = sorted.filter((f) => groupFor(groups, f.id)).sort((a, b) => rank(b) - rank(a));
  const ringFor = (f: Friend) => {
    const g = groupFor(groups, f.id);
    return g ? (g.allSeen ? 'seen' : 'new') : f.online ? 'online' : f.favorite ? 'favorite' : 'none';
  };
  const openFriend = (f: Friend) => (groupFor(groups, f.id) ? useStatus.setState({ viewing: f.id }) : setPicked(f));
  const compose = () => useStatus.setState({ composing: true });

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl pb-28 md:pb-8">
        <Hero me={me} />

        {/* search / add */}
        <form onSubmit={addByUsername} className="relative z-10 -mt-1 flex items-center gap-2 px-4">
          <label className="field h-12 flex-1 !border-transparent bg-surface/90 shadow-[var(--shadow-sm)] backdrop-blur">
            <Icon name="search" size={19} className="text-faint" />
            <input
              id="friend-search"
              placeholder="Search or add friends"
              value={q}
              autoCapitalize="none"
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} className="text-faint" aria-label="Clear">
                <Icon name="x" size={18} />
              </button>
            ) : (
              <>
                <Link to="/scan" className="text-muted" aria-label="Scan a QR ID">
                  <Icon name="camera" size={20} />
                </Link>
                <Link to="/profile?qr=1" className="text-muted" aria-label="My QR ID">
                  <Icon name="qr" size={20} />
                </Link>
              </>
            )}
          </label>
          {q.trim() && (
            <button className="btn btn-primary h-12 !px-4">
              <Icon name="userPlus" size={18} /> Add
            </button>
          )}
        </form>

        {results ? (
          <div className="mt-4 grid grid-cols-1 gap-2.5 px-4">
            <h2 className="px-1 text-xs font-bold tracking-wide text-faint uppercase">People</h2>
            {results.length === 0 && <p className="px-1 py-4 text-sm text-muted">No one found with that name.</p>}
            {results.map((u) => (
              <PersonCard key={u.id} user={u} subtitle={`@${u.username}`}>
                {u.isFriend ? (
                  <span className="text-xs font-bold text-faint">Friend</span>
                ) : (
                  <AddButton user={u} onAdded={() => setResults((r) => r?.map((x) => (x.id === u.id ? { ...x, isFriend: true } : x)) ?? null)} />
                )}
              </PersonCard>
            ))}
          </div>
        ) : (
          <>
            {/* story-style row of friends */}
            <div className="mt-4 flex gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <StoryCard label="Add status" onClick={compose}>
                <span className="relative">
                  <Avatar user={me} size={54} />
                  <span className="absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-white ring-2 ring-surface">
                    <Icon name="plus" size={14} strokeWidth={2.6} />
                  </span>
                </span>
              </StoryCard>
              {mine && (
                <StoryCard label="My status" onClick={() => useStatus.setState({ viewing: me.id })} look={mine.statuses[mine.statuses.length - 1].style}>
                  <StatusRing state="seen">
                    <Avatar user={me} size={50} />
                  </StatusRing>
                </StoryCard>
              )}
              {stories.map((f) => {
                const g = groupFor(groups, f.id);
                return (
                  <StoryCard key={f.id} label={f.displayName} onClick={() => openFriend(f)} look={g && !g.allSeen ? g.statuses[g.statuses.length - 1].style : undefined}>
                    <StatusRing state={ringFor(f)}>
                      <Avatar user={f} size={50} />
                    </StatusRing>
                  </StoryCard>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2.5 px-4">
              {addedMe.length > 0 && <h2 className="px-1 text-xs font-bold tracking-wide text-faint uppercase">Added you · {addedMe.length}</h2>}
              {addedMe.map((u) => (
                <PersonCard key={u.id} user={u} subtitle={`@${u.username} added you`}>
                  <AddButton user={u} label="Add back" />
                </PersonCard>
              ))}
              {addedMe.length > 0 && friends.length > 0 && <h2 className="mt-2 px-1 text-xs font-bold tracking-wide text-faint uppercase">Your friends · {friends.length}</h2>}

              {friendsLoaded && friends.length === 0 && (
                <div className="anim-rise rounded-[24px] bg-surface px-6 py-10 text-center shadow-[var(--shadow-sm)]">
                  <img src={stickerUrl('pomi-02')} alt="" className="anim-float mx-auto h-28 w-28 object-contain" />
                  <p className="mt-2 font-semibold">No friends yet</p>
                  <p className="text-sm text-muted">
                    Add someone by their username, or share your QR ID. You’re <b>@{me.username}</b>.
                  </p>
                </div>
              )}
              {sorted.map((f) => (
                <FriendCard key={f.id} f={f} onPick={() => setPicked(f)} />
              ))}
            </div>
          </>
        )}
      </div>
      <FriendSheet f={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

/** Your cover photo washed into the page, with your avatar, name and status in the middle. */
function Hero({ me }: { me: User }) {
  const tint = BUDDY_TINT[(me.avatar in BUDDY_TINT ? me.avatar : 'pepo') as Buddy];
  return (
    <header className="relative overflow-hidden">
      <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${tint}, var(--primary-soft))` }}>
        {me.coverUrl && <img src={me.coverUrl} alt="" className="h-full w-full object-cover opacity-70" />}
        <span className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-white/30" />
        <span className="absolute top-16 -right-12 h-44 w-44 rounded-full bg-white/25" />
        {/* soft fade into the page */}
        <span className="absolute inset-0 bg-gradient-to-b from-white/10 via-white/25 to-[var(--bg)]" />
      </div>
      <div className="safe-top relative flex justify-end px-4 pt-3">
        <CoinButton />
      </div>
      <Link to="/profile" className="relative flex flex-col items-center px-6 pt-1 pb-6 text-center">
        <span className="rounded-full bg-white/70 p-1 shadow-[0_8px_24px_rgba(90,111,208,0.25)] ring-2 ring-white">
          <Avatar user={me} size={78} />
        </span>
        <h1 className="mt-2 font-display text-[26px] leading-tight font-semibold tracking-wide drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
          {me.displayName}
        </h1>
        <p className="mt-0.5 line-clamp-2 max-w-xs text-sm font-semibold text-muted">{me.bio || `@${me.username}`}</p>
      </Link>
    </header>
  );
}

function PersonCard({ user, subtitle, children, onClick }: { user: User; subtitle: string; children?: React.ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <span className="rounded-full p-[2px] ring-2 ring-primary-soft">
        <Avatar user={user} size={50} showOnline />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[16px] font-bold">{user.displayName}</span>
        <span className="block truncate text-[13px] text-muted">{subtitle}</span>
      </span>
    </>
  );
  return (
    <div className="anim-rise flex items-center gap-3 rounded-[24px] bg-surface py-3 pr-3 pl-3 shadow-[var(--shadow-sm)]">
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

function FriendCard({ f, onPick }: { f: Friend; onPick: () => void }) {
  const latest = useStatus((s) => groupFor(s.groups, f.id)?.statuses.at(-1)?.text);
  return (
    <PersonCard user={f} onClick={onPick} subtitle={latest ? `💬 ${latest}` : f.bio || (f.online ? 'Online now' : lastSeen(f.lastSeenAt, false))}>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={`text-[11px] font-extrabold ${f.online ? 'text-[var(--success)]' : 'text-faint'}`}>
          {f.online ? 'ONLINE' : f.lastSeenAt ? listStamp(f.lastSeenAt).toUpperCase() : ''}
        </span>
        <span className="flex items-center gap-1.5">
          {!f.mutual && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary-strong">Pending</span>}
          <button
            className={`grid h-8 w-8 place-items-center rounded-full bg-surface-2 ring-1 ring-line transition active:scale-90 ${f.favorite ? 'text-[#f2b33d]' : 'text-faint'}`}
            onClick={() => setFavorite(f.id, !f.favorite).catch((e) => toast(errorText(e), 'error'))}
            aria-label={f.favorite ? 'Remove from favourites' : 'Add to favourites'}
          >
            <Icon name="star" size={16} fill={f.favorite ? 'currentColor' : 'none'} />
          </button>
        </span>
      </span>
    </PersonCard>
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
