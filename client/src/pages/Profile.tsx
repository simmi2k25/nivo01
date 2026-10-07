import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Avatar, BuddyAvatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { CoinButton } from '../components/CoinStore';
import { Loader } from '../components/Loader';
import { PhotoCropper } from '../components/PhotoCropper';
import { ProfileStage } from '../components/ProfileStage';
import { QrSheet } from '../components/QrSheet';
import { Sheet } from '../components/Sheet';
import { SongCard } from '../components/SongCard';
import { deviceCountry, SongPicker } from '../components/SongPicker';
import { toast } from '../components/Toast';
import { addFriend, blockUser, openDirectChat, startBoothWith, unblockUser } from '../lib/actions';
import { api, ApiError, errorText } from '../lib/api';
import { player, useStopOnLeave } from '../lib/audio';
import { lastSeen } from '../lib/format';
import { prepareImage } from '../lib/image';
import { notifyPrefs, playNotifySound, requestSystemNotify, systemNotifyAllowed, systemNotifySupported } from '../lib/notify';
import { applyBubble, applyTheme, BUBBLES, getPref, getTheme, setPref } from '../lib/prefs';
import { BUDDIES, BUDDY_NAMES } from '../lib/stickers';
import type { Buddy, ProfileUser, Song, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useCoins } from '../stores/coins';
import { useChat } from '../stores/chat';

function ActionButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex flex-1 flex-col items-center gap-1.5 py-2 text-[13px] font-bold transition active:scale-95 disabled:opacity-60">
      <Icon name={icon} size={24} />
      {label}
    </button>
  );
}

function Identity({ user, editing }: { user: User; editing?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="anim-pop delay-2 rounded-[30%] p-1 ring-2 ring-white/40">
        <Avatar user={user} size={editing ? 112 : 96} rounded="xl" />
      </span>
      {!editing && (
        <>
          <h1 className="anim-rise delay-3 mt-3 text-2xl font-semibold drop-shadow">{user.displayName}</h1>
          <p className="anim-rise delay-3 text-sm font-semibold opacity-80">@{user.username}</p>
          {user.bio && <p className="anim-rise delay-4 mt-1.5 max-w-[300px] text-[14px] whitespace-pre-line opacity-95 drop-shadow">{user.bio}</p>}
        </>
      )}
    </div>
  );
}

/** The pink heart with someone's friend count, floating on their profile. */
function FriendHeart({ count, to }: { count: number; to?: string }) {
  const heart = (
    <>
      <svg width="58" height="54" viewBox="0 0 24 22" style={{ animation: 'heart-glow 2.6s ease-in-out infinite' }} aria-hidden="true">
        <path d="M12 21s-9-5.3-9-12.1A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9 2.9C21 15.7 12 21 12 21Z" fill="#ff9fb8" stroke="#fff" strokeWidth="1.2" />
      </svg>
      <span className="absolute top-[15px] text-sm font-extrabold">{count}</span>
    </>
  );
  const cls = 'anim-pop delay-4 absolute top-[30%] right-6 grid place-items-center';
  const label = `${count} ${count === 1 ? 'friend' : 'friends'}`;
  return to ? (
    <Link to={to} className={cls} aria-label={label}>
      {heart}
    </Link>
  ) : (
    <span className={cls} role="img" aria-label={label} title={label}>
      {heart}
    </span>
  );
}

// ------------------------------------------------------------------ my profile

export function MyProfilePage() {
  const me = useAuth((s) => s.user)!;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const qrOpen = params.get('qr') === '1';
  useStopOnLeave();

  useEffect(() => {
    api<{ user: ProfileUser }>(`/users/${me.username}`)
      .then((r) => setFriendCount(r.user.friendCount))
      .catch(() => {});
  }, [me.username]);

  if (editing) return <EditProfile me={me} onDone={() => setEditing(false)} />;

  return (
    <ProfileStage cover={me.coverUrl} buddy={me.avatar}>
      <div className="safe-top flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">{me.song && <SongCard song={me.song} />}</div>
        <div className="flex shrink-0 items-center gap-1">
          <CoinButton light />
          <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => setParams({ qr: '1' })} aria-label="My QR ID">
            <Icon name="qr" />
          </button>
          <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => setSettings(true)} aria-label="Settings">
            <Icon name="settings" />
          </button>
        </div>
      </div>
      {friendCount !== null && <FriendHeart count={friendCount} to="/friends" />}
      <div className="flex-1" />
      <div className="px-6 pb-4">
        <Identity user={me} />
      </div>
      <div className="mx-4 mb-[calc(84px+env(safe-area-inset-bottom))] flex border-t border-white/25 pt-2 md:mb-4">
        <ActionButton icon="images" label="Memories" onClick={() => nav('/memories')} />
        <ActionButton icon="edit" label="Edit profile" onClick={() => setEditing(true)} />
        <ActionButton icon="qr" label="QR ID" onClick={() => setParams({ qr: '1' })} />
      </div>
      <QrSheet open={qrOpen} onClose={() => setParams({})} user={me} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </ProfileStage>
  );
}

// ------------------------------------------------------------------ edit in place

type Pending = {
  avatar?: Blob | 'remove';
  cover?: Blob | 'remove';
  song?: Song | 'remove';
};

function EditProfile({ me, onDone }: { me: User; onDone: () => void }) {
  const setUser = useAuth((s) => s.setUser);
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [buddy, setBuddy] = useState<Buddy>(me.avatar);
  const [pending, setPending] = useState<Pending>({});
  const [previews, setPreviews] = useState<{ avatar?: string; cover?: string }>({});
  const [photoSheet, setPhotoSheet] = useState(false);
  const [songSheet, setSongSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => Object.values(previews).forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  async function pickImage(kind: 'avatar' | 'cover', file?: File) {
    if (!file) return;
    try {
      // Prepared on the device: rotation applied, cropped/scaled, JPEG.
      const blob = await prepareImage(file, kind === 'avatar' ? { square: true, max: 640 } : { max: 1440 });
      setPending((p) => ({ ...p, [kind]: blob }));
      setPreviews((p) => ({ ...p, [kind]: URL.createObjectURL(blob) }));
    } catch {
      toast('That picture couldn’t be opened', 'error');
    }
  }

  const coverShown = pending.cover === 'remove' ? null : (previews.cover ?? me.coverUrl);
  const avatarShown = pending.avatar === 'remove' ? null : (previews.avatar ?? me.avatarUrl);
  const songShown = pending.song === 'remove' ? null : (pending.song ?? me.song);
  const draft: User = { ...me, displayName: name, avatar: buddy, avatarUrl: avatarShown };

  async function save() {
    if (!name.trim()) return toast('Name can’t be empty', 'error');
    setSaving(true);
    try {
      let u: User = me;
      const r = await api<{ user: User }>('/users/me', { method: 'PATCH', body: { displayName: name.trim(), bio: bio.trim(), avatar: buddy } });
      u = r.user;
      for (const kind of ['avatar', 'cover'] as const) {
        const v = pending[kind];
        if (v === 'remove') u = (await api<{ user: User }>(`/users/me/${kind}`, { method: 'DELETE' })).user;
        else if (v) u = (await api<{ user: User }>(`/users/me/${kind}`, { method: 'PUT', raw: v })).user;
      }
      if (pending.song === 'remove') u = (await api<{ user: User }>('/users/me/song', { method: 'DELETE' })).user;
      else if (pending.song) u = (await api<{ user: User }>('/users/me/song', { method: 'PUT', body: { trackId: pending.song.trackId, country: deviceCountry() } })).user;
      setUser(u);
      useChat.getState().patchUser(u);
      toast('Profile saved ✨');
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileStage cover={coverShown} buddy={buddy}>
      <div className="safe-top flex items-center justify-between px-3 py-3">
        <button className="btn btn-ghost btn-sm !text-white" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <span className="font-display font-semibold">Edit profile</span>
        <button className="btn btn-ghost btn-sm !font-bold !text-white" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-6">
        <button
          className="mx-auto mb-3 flex items-center gap-2 rounded-2xl bg-white/18 px-3 py-2 text-sm font-bold ring-1 ring-white/25 backdrop-blur-md"
          onClick={() => (songShown ? player.stop() : null, setSongSheet(true))}
        >
          <Icon name="music" size={16} />
          {songShown ? (
            <span className="max-w-[200px] truncate">
              {songShown.title} · {songShown.artist}
            </span>
          ) : (
            'Add a song'
          )}
          {songShown && (
            <span
              role="button"
              tabIndex={0}
              className="ml-1 rounded-full bg-white/25 p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                setPending((p) => ({ ...p, song: 'remove' }));
              }}
              aria-label="Remove song"
            >
              <Icon name="x" size={14} />
            </span>
          )}
        </button>

        <button className="relative mx-auto" onClick={() => setPhotoSheet(true)} aria-label="Change profile photo">
          <Identity user={draft} editing />
          <span className="absolute right-0 bottom-1 grid h-9 w-9 place-items-center rounded-full bg-white text-primary-strong shadow-lg">
            <Icon name="camera" size={18} />
          </span>
        </button>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <input
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-2xl bg-white/18 px-4 text-center font-bold text-white ring-1 ring-white/25 outline-none backdrop-blur-md placeholder:text-white/60 focus:ring-white/60"
            placeholder="Your name"
            aria-label="Name"
          />
          <textarea
            value={bio}
            maxLength={150}
            rows={2}
            onChange={(e) => setBio(e.target.value)}
            className="resize-none rounded-2xl bg-white/18 px-4 py-2.5 text-center text-sm text-white ring-1 ring-white/25 outline-none backdrop-blur-md placeholder:text-white/60 focus:ring-white/60"
            placeholder="Write a little bio ✨"
            aria-label="Bio"
          />
          <p className="text-center text-xs opacity-75">{bio.length}/150</p>
        </div>
      </div>

      <div className="mx-4 mt-2 mb-[calc(84px+env(safe-area-inset-bottom))] flex border-t border-white/25 pt-2 md:mb-4">
        <ActionButton icon="image" label="Background" onClick={() => coverInput.current?.click()} />
        <ActionButton
          icon="trash"
          label="Reset background"
          disabled={!coverShown}
          onClick={() => {
            setPending((p) => ({ ...p, cover: 'remove' }));
            setPreviews((p) => ({ ...p, cover: undefined }));
          }}
        />
        <ActionButton icon="smile" label="Photo & buddy" onClick={() => setPhotoSheet(true)} />
      </div>

      <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => (pickImage('cover', e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => (setCropFile(e.target.files?.[0] ?? null), (e.target.value = ''))} />
      <PhotoCropper
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onDone={(blob) => {
          setCropFile(null);
          setPending((p) => ({ ...p, avatar: blob }));
          setPreviews((p) => ({ ...p, avatar: URL.createObjectURL(blob) }));
        }}
      />

      <Sheet open={photoSheet} onClose={() => setPhotoSheet(false)} title="Photo & buddy">
        <div className="grid grid-cols-1 gap-2">
          <button className="btn btn-primary w-full" onClick={() => (setPhotoSheet(false), avatarInput.current?.click())}>
            <Icon name="image" size={19} /> Choose a photo
          </button>
          {avatarShown && (
            <button
              className="btn btn-danger w-full"
              onClick={() => {
                setPending((p) => ({ ...p, avatar: 'remove' }));
                setPreviews((p) => ({ ...p, avatar: undefined }));
              }}
            >
              <Icon name="trash" size={19} /> Remove photo
            </button>
          )}
          <p className="mt-2 text-sm font-bold text-muted">Buddy (shown when there’s no photo)</p>
          <div className="flex justify-between">
            {BUDDIES.map((b) => (
              <button key={b} onClick={() => setBuddy(b)} className={`flex flex-col items-center gap-1 rounded-2xl p-1.5 text-xs font-bold ${buddy === b ? 'bg-primary-soft text-primary-strong' : 'text-muted'}`}>
                <BuddyAvatar buddy={b} size={50} />
                {BUDDY_NAMES[b]}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      <SongPicker
        open={songSheet}
        onClose={() => setSongSheet(false)}
        onPick={(s) => {
          setPending((p) => ({ ...p, song: s }));
          setSongSheet(false);
        }}
      />
    </ProfileStage>
  );
}

// ------------------------------------------------------------------ settings

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const logout = useAuth((s) => s.logout);
  const me = useAuth((s) => s.user)!;
  const [theme, setTheme] = useState(getTheme());
  const [bubble, setBubble] = useState(getPref('bubble', 'periwinkle'));
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="grid grid-cols-1 gap-5">
        <div>
          <p className="mb-2 text-sm font-bold text-muted">Appearance</p>
          <div className="segmented w-full">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                className="flex flex-1 items-center justify-center gap-1.5"
                aria-pressed={theme === t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                <Icon name={t === 'light' ? 'sun' : 'moon'} size={17} /> {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-bold text-muted">Chat bubble colour</p>
          <div className="flex gap-2.5">
            {BUBBLES.map((b) => (
              <button
                key={b.id}
                className={`h-9 w-9 rounded-full transition ${bubble === b.id ? 'scale-110 ring-[3px] ring-primary ring-offset-2 ring-offset-surface' : ''}`}
                style={{ background: b.color }}
                onClick={() => {
                  setBubble(b.id);
                  applyBubble(b.id);
                  setPref('bubble', b.id);
                }}
                aria-label={b.id}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <span className="rounded-[20px] rounded-br-md bg-[var(--bubble-me)] px-3.5 py-2 text-sm text-[var(--bubble-me-text)]">Looks cute! 💕</span>
          </div>
        </div>
        <NotificationSettings />
        <BlockedPeople />
        <div className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          <p className="font-bold">@{me.username}</p>
          {me.email && <p className="text-muted">{me.email}</p>}
        </div>
        <button className="btn btn-danger w-full" onClick={() => logout()}>
          <Icon name="logout" size={19} /> Log out
        </button>
      </div>
    </Sheet>
  );
}

function BlockedPeople() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<User[] | null>(null);
  useEffect(() => {
    if (!open) return;
    api<{ users: User[] }>('/blocks')
      .then((r) => setList(r.users))
      .catch(() => setList([]));
  }, [open]);
  return (
    <div>
      <button className="flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="lock" size={18} />
        <span className="flex-1">Blocked people</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={18} className="text-muted" />
      </button>
      {open && (
        <div className="mt-2 grid gap-1">
          {list === null && <p className="px-2 text-sm text-muted">Loading…</p>}
          {list?.length === 0 && <p className="px-2 text-sm text-muted">You haven’t blocked anyone.</p>}
          {list?.map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-2xl px-2 py-1.5">
              <Avatar user={b} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{b.displayName}</span>
                <span className="block truncate text-xs text-muted">@{b.username}</span>
              </span>
              <button
                className="btn btn-soft btn-sm"
                onClick={async () => {
                  try {
                    await unblockUser(b.id);
                    setList((l) => l?.filter((x) => x.id !== b.id) ?? null);
                    toast(`Unblocked ${b.displayName}`);
                  } catch (e) {
                    toast(errorText(e), 'error');
                  }
                }}
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationSettings() {
  const [sound, setSound] = useState(notifyPrefs.sound());
  const [popups, setPopups] = useState(notifyPrefs.popups());
  const [system, setSystem] = useState(systemNotifyAllowed());
  const blocked = systemNotifySupported() && Notification.permission === 'denied';
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-muted">Notifications</p>
      <div className="grid gap-1 rounded-2xl bg-surface-2 p-1.5">
        <SettingRow
          icon="bell"
          label="Pop-ups for new messages"
          on={popups}
          onChange={(v) => {
            setPopups(v);
            notifyPrefs.setPopups(v);
          }}
        />
        <SettingRow
          icon="music"
          label="Notification sound"
          on={sound}
          onChange={(v) => {
            setSound(v);
            notifyPrefs.setSound(v);
            if (v) playNotifySound(true);
          }}
        />
        {systemNotifySupported() && (
          <SettingRow
            icon="sparkle"
            label={blocked ? 'Alerts blocked in browser settings' : 'Alerts when NivoTalk is in the background'}
            on={system}
            disabled={blocked || system}
            onChange={async (v) => {
              if (v) setSystem(await requestSystemNotify());
            }}
          />
        )}
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  label,
  on,
  disabled,
  onChange,
}: {
  icon: 'bell' | 'music' | 'sparkle';
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold disabled:opacity-70"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <Icon name={icon} size={18} />
      <span className="flex-1">{label}</span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${on ? 'bg-primary' : 'bg-black/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

/** Send coins to a friend; a note shows up in your chat with them. */
function GiftSheet({ open, onClose, to }: { open: boolean; onClose: () => void; to: User }) {
  const coins = useCoins((s) => s.coins);
  const [amount, setAmount] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const r = await api<{ coins: number }>('/coins/gift', { body: { userId: to.id, amount, note: note.trim() || undefined } });
      useCoins.getState().setBalance({ coins: r.coins });
      toast(`Sent ${amount} ${amount === 1 ? 'coin' : 'coins'} to ${to.displayName} 🪙`);
      setNote('');
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Gift coins to ${to.displayName}`}>
      <div className="grid gap-3">
        <p className="text-sm text-muted">You have 🪙 {coins}</p>
        <div className="flex gap-2">
          {[1, 5, 10, 25].map((n) => (
            <button key={n} className="chip flex-1 justify-center" aria-pressed={amount === n} onClick={() => setAmount(n)}>
              🪙 {n}
            </button>
          ))}
        </div>
        <label className="field h-11">
          <span className="text-sm font-bold text-muted">Amount</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))))}
            className="text-right font-bold"
          />
        </label>
        <label className="field h-11">
          <Icon name="edit" size={18} className="text-faint" />
          <input placeholder="Add a note (optional)" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn btn-primary w-full" disabled={busy || amount > coins} onClick={send}>
          <Icon name="gift" size={19} /> {amount > coins ? 'Not enough coins' : `Send ${amount} ${amount === 1 ? 'coin' : 'coins'}`}
        </button>
        {amount > coins && (
          <button className="btn btn-soft w-full" onClick={() => useCoins.getState().openStore()}>
            Get more coins
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ someone else

export function UserProfilePage() {
  const { username = '' } = useParams();
  const nav = useNavigate();
  const me = useAuth((s) => s.user)!;
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [gift, setGift] = useState(false);
  // Live updates when they change their photo or bio.
  const live = useChat((s) => (user ? (s.friends.find((f) => f.id === user.id) ?? s.conversations.flatMap((c) => c.members).find((m) => m.id === user.id)) : undefined));
  useStopOnLeave();

  useEffect(() => {
    if (username.toLowerCase() === me.username) {
      nav('/profile', { replace: true });
      return;
    }
    setUser(null);
    setError('');
    api<{ user: ProfileUser }>(`/users/${encodeURIComponent(username.toLowerCase())}`)
      .then((r) => setUser(r.user))
      .catch((e) => setError(errorText(e)));
  }, [username, me.username, nav]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-semibold">{error}</p>
          <button className="btn btn-soft btn-sm mt-3" onClick={() => nav(-1)}>
            Go back
          </button>
        </div>
      </div>
    );
  }
  if (!user) return <Loader compact />;
  const u: ProfileUser = live ? { ...user, ...live } : user;

  const act = (fn: () => Promise<void>) => async () => {
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
    <ProfileStage cover={u.coverUrl} buddy={u.avatar}>
      <div className="safe-top flex items-center gap-2 p-3">
        <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/friends'))} aria-label="Close">
          <Icon name="x" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold opacity-90">{u.blockedByMe ? '' : lastSeen(u.lastSeenAt, u.online)}</span>
        <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => setMenu(true)} aria-label="More options">
          <Icon name="more" />
        </button>
      </div>
      {!u.blockedByMe && <FriendHeart count={u.friendCount} />}
      {u.song && (
        <div className="px-4">
          <SongCard song={u.song} />
        </div>
      )}
      <div className="flex-1" />
      <div className="px-6 pb-4">
        <Identity user={u} />
        {u.addedMe && !u.isFriend && !u.blockedByMe && <p className="mt-2 text-center text-xs font-bold opacity-80">{u.displayName} added you 💌</p>}
        {u.blockedByMe && <p className="mt-2 text-center text-sm font-bold opacity-90">You blocked {u.displayName}</p>}
      </div>
      {u.blockedByMe ? (
        <div className="mx-4 mb-[calc(84px+env(safe-area-inset-bottom))] border-t border-white/25 pt-3 md:mb-4">
          <button
            className="btn w-full bg-white/90 font-bold text-ink"
            disabled={busy}
            onClick={act(async () => {
              await unblockUser(u.id);
              setUser({ ...u, blockedByMe: false });
              toast(`Unblocked ${u.displayName}`);
            })}
          >
            Unblock
          </button>
        </div>
      ) : (
      <div className="mx-4 mb-[calc(84px+env(safe-area-inset-bottom))] flex border-t border-white/25 pt-2 md:mb-4">
        <ActionButton icon="chat" label="Chat" disabled={busy} onClick={act(async () => nav(`/chats/${(await openDirectChat(u.id)).id}`))} />
        <ActionButton
          icon={u.isFriend ? 'userCheck' : 'userPlus'}
          label={u.isFriend ? 'Friends' : 'Add friend'}
          disabled={busy || u.isFriend}
          onClick={act(async () => {
            await addFriend({ userId: u.id });
            setUser({ ...u, isFriend: true });
            toast(`Added ${u.displayName} 💕`);
          })}
        />
        <ActionButton icon="camera" label="Photobooth" disabled={busy} onClick={act(async () => nav(`/booth/${(await startBoothWith(u.id)).code}`))} />
        {(u.isFriend || u.addedMe) && <ActionButton icon="gift" label="Gift coins" disabled={busy} onClick={() => setGift(true)} />}
      </div>
      )}
      <GiftSheet open={gift} onClose={() => setGift(false)} to={u} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={`@${u.username}`}>
        {u.blockedByMe ? (
          <button
            className="btn btn-soft w-full"
            disabled={busy}
            onClick={act(async () => {
              await unblockUser(u.id);
              setUser({ ...u, blockedByMe: false });
              setMenu(false);
              toast(`Unblocked ${u.displayName}`);
            })}
          >
            Unblock {u.displayName}
          </button>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted">
              {u.displayName} won’t be able to message you, add you or see your profile. You’ll stop being friends. They won’t be told.
            </p>
            <button
              className="btn btn-danger w-full"
              disabled={busy}
              onClick={act(async () => {
                await blockUser(u.id);
                setUser({ ...u, blockedByMe: true, isFriend: false, addedMe: false });
                setMenu(false);
                toast(`Blocked ${u.displayName}`);
              })}
            >
              <Icon name="lock" size={19} /> Block {u.displayName}
            </button>
          </div>
        )}
      </Sheet>
    </ProfileStage>
  );
}
