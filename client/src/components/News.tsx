import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorText } from '../lib/api';
import { listStamp } from '../lib/format';
import type { Announcement } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useNews } from '../stores/news';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { toast } from './Toast';

/** The blue tick-style badge shown next to the official NivoTalk account's name. */
export function OfficialBadge({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} role="img" aria-label="Official NivoTalk account">
      <path
        d="M12 1.8l2.4 1.8 3-.2 1 2.8 2.6 1.5-.6 2.9 1.4 2.7-2 2.2-.1 3-2.9.8-1.6 2.5-2.9-.9-2.7 1.3-2-2.2-3-.3-.6-2.9L1.7 14l.9-2.8-1-2.8 2.4-1.7.6-2.9 3-.2L10 1.9z"
        fill="#5a8cf0"
      />
      <path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Newest announcement on top of the chat list until it's been read. */
export function NewsBanner() {
  // Select the raw pieces: a filtered array would be a new value every render and loop forever.
  const list = useNews((s) => s.list);
  const seenId = useNews((s) => s.seenId);
  const show = useNews((s) => s.show);
  const unseen = list.filter((a) => a.id > seenId);
  const latest = unseen[0];
  if (!latest) return null;
  return (
    <button
      onClick={show}
      className="anim-rise mx-1 mb-2 flex w-[calc(100%-8px)] items-start gap-3 rounded-[22px] bg-gradient-to-r from-[#4357c4] to-[#6a7fe0] p-3.5 text-left text-white shadow-[0_10px_24px_rgba(67,87,196,0.3)]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20">
        <Icon name="bell" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          {latest.title || 'NivoTalk'}
          <OfficialBadge size={15} />
          {unseen.length > 1 && <span className="ml-auto rounded-full bg-white/25 px-2 text-[11px]">+{unseen.length - 1} more</span>}
        </span>
        <span className="line-clamp-2 text-[13.5px] leading-snug opacity-95">{latest.body}</span>
      </span>
    </button>
  );
}

/** All announcements; the admin also writes and removes them here. */
export function NewsSheet() {
  const me = useAuth((s) => s.user);
  const { list, open, hide, show } = useNews();
  const [params, setParams] = useSearchParams();

  // Push notifications open /chats?news=1.
  useEffect(() => {
    if (params.get('news') !== '1') return;
    show();
    params.delete('news');
    setParams(params, { replace: true });
  }, [params, setParams, show]);

  return (
    <Sheet open={open} onClose={hide} title="NivoTalk news">
      {me?.isAdmin && <Composer />}
      {list.length === 0 && <p className="py-8 text-center text-sm text-muted">No announcements yet.</p>}
      <div className="grid gap-2.5">
        {list.map((a) => (
          <Item key={a.id} a={a} canDelete={!!me?.isAdmin} />
        ))}
      </div>
    </Sheet>
  );
}

function Item({ a, canDelete }: { a: Announcement; canDelete: boolean }) {
  async function remove() {
    if (!confirm('Delete this announcement for everyone?')) return;
    try {
      await api(`/announcements/${a.id}`, { method: 'DELETE' });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }
  return (
    <article className="rounded-[20px] bg-surface-2 p-4">
      <div className="flex items-center gap-1.5">
        <b className="min-w-0 flex-1 truncate">{a.title || 'NivoTalk'}</b>
        <span className="shrink-0 text-xs font-semibold text-faint">{listStamp(a.createdAt)}</span>
        {canDelete && (
          <button className="icon-btn -my-2 -mr-2 !h-8 !w-8" onClick={remove} aria-label="Delete announcement">
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
      <p className="mt-1 text-[15px] leading-snug whitespace-pre-wrap break-words">{a.body}</p>
    </article>
  );
}

function Composer() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api('/announcements', { body: { title: title.trim(), body: body.trim() } });
      setTitle('');
      setBody('');
      toast('Posted to everyone 📣');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={post} className="mb-4 rounded-[22px] border border-line p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary-strong">
        <Icon name="edit" size={16} /> New announcement · everyone gets it
      </p>
      <label className="field h-11">
        <input placeholder="Title (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <textarea
        className="mt-2 min-h-[96px] w-full resize-y rounded-[18px] border-[1.5px] border-line bg-surface px-4 py-3 outline-none focus:border-primary"
        placeholder="What do you want everyone to know?"
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="btn btn-primary mt-2 w-full" disabled={busy || !body.trim()}>
        <Icon name="send" size={19} /> {busy ? 'Posting…' : 'Post to everyone'}
      </button>
    </form>
  );
}
