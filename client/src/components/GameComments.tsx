import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export type GameComment = { id: string; user: Pick<User, 'id' | 'displayName' | 'avatar' | 'avatarUrl'>; text: string };

/** How long a comment stays on screen. Stores drop it after this too. */
export const COMMENT_MS = 10_000;

const QUICK = ['GG 🔥', 'Nice one!', 'Noooo 😭', 'So lucky 🍀', 'Your turn!', 'Hehe 😈'];

/** The small chat button in a game's header: tap, type (or pick a quick one), and it floats up for everyone. */
export function CommentButton({ onSend, dark = false, className = '' }: { onSend: (text: string) => void; dark?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Tapping anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  function send(t: string) {
    const v = t.trim();
    if (!v) return;
    onSend(v);
    setText('');
    setOpen(false);
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        className={`grid h-10 w-10 place-items-center rounded-full transition active:scale-90 md:h-12 md:w-12 ${
          dark ? 'bg-white/10 text-white ring-1 ring-white/15 backdrop-blur' : 'bg-surface text-primary-strong shadow-[var(--shadow-sm)]'
        } ${open ? (dark ? '!bg-white/25' : '!bg-primary-soft') : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Comment"
        aria-expanded={open}
      >
        <Icon name="chat" size={20} />
      </button>
      {open && (
        <div className="anim-pop fixed inset-x-3 top-[calc(env(safe-area-inset-top)+64px)] z-50 rounded-[22px] md:absolute md:inset-x-auto md:top-full md:right-0 md:mt-2 md:w-[320px] bg-surface p-2.5 text-ink shadow-[0_18px_40px_rgba(20,25,70,0.28)] ring-1 ring-line">
          <form onSubmit={submit} className="game-compose flex items-center gap-1.5 rounded-full bg-surface-2 p-1 pl-3.5">
            <input
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-faint"
              placeholder="Say something…"
              value={text}
              maxLength={80}
              onChange={(e) => setText(e.target.value)}
              enterKeyHint="send"
              autoFocus
            />
            <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-white transition active:scale-90 disabled:opacity-40" disabled={!text.trim()} aria-label="Send">
              <Icon name="send" size={17} />
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} className="rounded-full bg-primary-soft px-3 py-1.5 text-[13px] font-bold text-primary-strong transition active:scale-95" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Comments bubbling up the side of the table; each one fades away after ten seconds. */
export function CommentBubbles({ comments, meId, className = '' }: { comments: GameComment[]; meId: number; className?: string }) {
  return (
    <div className={`pointer-events-none fixed z-30 flex flex-col items-start gap-1.5 ${className}`} aria-live="polite">
      {comments.slice(-4).map((c) => {
        const mine = c.user.id === meId;
        return (
          <div
            key={c.id}
            className="game-comment flex max-w-[min(280px,78vw)] items-center gap-2 rounded-[20px] rounded-bl-md bg-surface/95 py-1.5 pr-3.5 pl-1.5 text-ink shadow-[0_10px_26px_rgba(20,25,70,0.22)] ring-1 ring-black/5 backdrop-blur"
            style={{ animationDuration: `${COMMENT_MS}ms` }}
          >
            <Avatar user={c.user as User} size={28} />
            <span className="min-w-0 leading-tight">
              <span className={`block text-[11px] font-extrabold ${mine ? 'text-primary' : 'text-primary-strong'}`}>{mine ? 'You' : c.user.displayName}</span>
              <span className="block text-[14px] font-semibold break-words">{c.text}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
