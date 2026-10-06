import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppShell } from './components/AppShell';
import { Loader } from './components/Loader';
import { Toaster } from './components/Toast';
import { hideNativeSplash } from './lib/native';
import { ChatsPage } from './pages/Chats';
import { FriendsPage } from './pages/Friends';
import { LoginPage } from './pages/Login';
import { MyProfilePage, UserProfilePage } from './pages/Profile';
import { useAuth } from './stores/auth';
import { useChat } from './stores/chat';

// Heavy photobooth code (camera, WebRTC, strip editor) loads only when opened.
const BoothHome = lazy(() => import('./pages/booth/BoothHome'));
const BoothRoom = lazy(() => import('./pages/booth/BoothRoom'));
const Memories = lazy(() => import('./pages/Memories'));

export function App() {
  const { status, user, waking, init } = useAuth();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    // Swap the HTML boot loader for the app once we know who's signed in.
    if (status !== 'ready') return;
    const boot = document.getElementById('boot');
    boot?.classList.add('gone');
    const t = setTimeout(() => boot?.remove(), 400);
    hideNativeSplash();
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (!user) return;
    useChat.getState().loadConversations().catch(() => {});
    useChat.getState().loadFriends().catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') {
    // The boot loader in index.html covers this; show ours too once the wait gets long.
    return waking ? <Loader waking /> : null;
  }

  return (
    <>
      <Toaster />
      <Suspense fallback={<Loader compact />}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to={nextFrom()} replace /> : <LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/chats" element={<ChatsPage />} />
              <Route path="/chats/:id" element={<ChatsPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/booth" element={<BoothHome />} />
              <Route path="/booth/:code" element={<BoothRoom />} />
              <Route path="/memories" element={<Memories />} />
              <Route path="/profile" element={<MyProfilePage />} />
              <Route path="/u/:username" element={<UserProfilePage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to={user ? '/chats' : '/login'} replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function nextFrom() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/chats';
}

function RequireAuth() {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) {
    const next = loc.pathname + loc.search;
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }
  return <Outlet />;
}
