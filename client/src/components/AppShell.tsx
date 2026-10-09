import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { Avatar } from './Avatar';
import { CoinStore } from './CoinStore';
import { Icon, type IconName } from './Icon';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/friends', label: 'Friends', icon: 'users' },
  { to: '/chats', label: 'Chats', icon: 'chat' },
  { to: '/together', label: 'Together', icon: 'together' },
  { to: '/memories', label: 'Memories', icon: 'images' },
];

export function AppShell() {
  const user = useAuth((s) => s.user)!;
  const unread = useChat((s) => s.conversations.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0));
  const loc = useLocation();
  // Inside a chat, a live booth or a Chill Room the phone tab bar steps aside for the composer / camera / player.
  const immersive =
    /^\/chats\/\d+/.test(loc.pathname) || /^\/(booth|chill)\/[A-Za-z0-9]{6}/.test(loc.pathname) || loc.pathname === '/scan';
  // The booth lives under Together now, so Together stays lit while you're setting one up.
  const togetherActive = /^\/(together|booth)(\/|$)/.test(loc.pathname);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* Desktop rail */}
      <nav className="hidden w-[88px] shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-5 md:flex">
        <img src="/brand/badge-256.png" alt="NivoTalk" className="mb-4 h-12 w-12 rounded-full shadow-md" />
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `relative flex w-16 flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-bold transition ${
                isActive || (t.to === '/together' && togetherActive) ? 'bg-primary-soft text-primary-strong' : 'text-muted hover:bg-surface-2'
              }`
            }
          >
            <Icon name={t.icon} />
            {t.label}
            {t.to === '/chats' && unread > 0 && <span className="badge-count absolute top-1 right-2">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink to="/profile" className="rounded-full p-0.5 ring-2 ring-transparent transition hover:ring-primary-soft" aria-label="My profile">
          <Avatar user={user} size={44} />
        </NavLink>
      </nav>

      <main className="relative min-w-0 flex-1">
        <Outlet />
      </main>
      <CoinStore />

      {/* Phone floating tab bar */}
      {!immersive && (
        <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-2 md:hidden">
          <div className="pointer-events-auto mx-auto flex max-w-md items-end justify-around rounded-[26px] bg-surface/95 px-1.5 pt-1.5 pb-1.5 shadow-[0_8px_30px_rgba(90,111,208,0.18)] backdrop-blur">
            {TABS.map((t) =>
              t.to === '/together' ? (
                <TogetherTab key={t.to} active={togetherActive} />
              ) : (
                <TabLink key={t.to} {...t} badge={t.to === '/chats' ? unread : 0} />
              ),
            )}
            <NavLink to="/profile" className="group flex w-16 flex-col items-center gap-0.5 pt-1 text-[10.5px] font-bold text-muted">
              {({ isActive }) => (
                <>
                  <span className={`rounded-full p-[2px] transition ${isActive ? 'ring-2 ring-primary' : ''}`}>
                    <Avatar user={user} size={28} />
                  </span>
                  <span className={isActive ? 'text-primary-strong' : ''}>Me</span>
                </>
              )}
            </NavLink>
          </div>
        </nav>
      )}
    </div>
  );
}

function TabLink({ to, label, icon, badge }: { to: string; label: string; icon: IconName; badge: number }) {
  return (
    <NavLink to={to} className="flex w-16 flex-col items-center gap-0.5 text-[10.5px] font-bold">
      {({ isActive }) => (
        <>
          <span
            className={`relative grid h-10 w-10 place-items-center rounded-full transition-all duration-300 ${
              isActive ? '-translate-y-2.5 bg-primary text-white shadow-[0_6px_16px_rgba(90,111,208,0.45)]' : 'text-muted'
            }`}
            style={{ transitionTimingFunction: 'cubic-bezier(0.3, 1.6, 0.5, 1)' }}
          >
            <Icon name={icon} size={21} />
            {badge > 0 && <span className="badge-count absolute -top-1 -right-2">{badge > 99 ? '99+' : badge}</span>}
          </span>
          <span className={`-mt-1.5 transition ${isActive ? 'text-primary-strong' : 'text-muted'}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** The raised centre button of the phone tab bar. */
function TogetherTab({ active }: { active: boolean }) {
  return (
    <NavLink to="/together" className="flex w-[72px] flex-col items-center text-[10.5px] font-bold" aria-label="Together">
      <span
        className={`-mt-7 grid h-[58px] w-[58px] place-items-center rounded-full bg-gradient-to-b from-primary to-primary-strong text-white shadow-[0_8px_22px_rgba(90,111,208,0.5)] ring-4 ring-bg transition ${
          active ? 'scale-105' : ''
        }`}
      >
        <Icon name="together" size={26} />
      </span>
      <span className={`mt-1 ${active ? 'text-primary-strong' : 'text-muted'}`}>Together</span>
    </NavLink>
  );
}
