import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { dismissPopup, setNotifyNavigator, usePopups } from '../lib/notify';
import type { Buddy } from '../lib/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/** Pop-up cards for new messages and friend adds; tapping one opens it. */
export function Notifications() {
  const list = usePopups((s) => s.list);
  const nav = useNavigate();

  useEffect(() => {
    setNotifyNavigator(nav);
    return () => setNotifyNavigator(null);
  }, [nav]);

  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-3 safe-top" aria-live="polite">
      {list.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          className="anim-pop pointer-events-auto flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 shadow-lg ring-1 ring-black/5"
          onClick={() => {
            dismissPopup(p.id);
            nav(p.to);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              dismissPopup(p.id);
              nav(p.to);
            }
          }}
        >
          {p.user ? (
            <Avatar user={{ ...p.user, avatar: p.user.avatar as Buddy }} size={40} />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-primary">
              <Icon name="bell" size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{p.title}</p>
            <p className="truncate text-sm text-muted">{p.body}</p>
          </div>
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissPopup(p.id);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
