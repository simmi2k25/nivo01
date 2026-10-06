import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BuddyAvatar } from '../components/Avatar';
import { BoothIllustration } from '../components/BoothIllustration';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { api, errorText } from '../lib/api';
import { BUDDIES, BUDDY_NAMES } from '../lib/stickers';
import type { Buddy } from '../lib/types';
import { useAuth } from '../stores/auth';

type Tab = 'login' | 'signup';

export function LoginPage() {
  const [tab, setTab] = useState<Tab>('login');
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg md:flex-row md:items-center md:justify-center md:gap-10 md:px-10">
      <Blobs />
      {/* Hero: badge, headline, illustration */}
      <section className="relative flex min-h-0 flex-1 flex-col items-center px-6 pt-[max(14px,env(safe-area-inset-top))] md:max-w-lg md:flex-none md:basis-1/2 md:pt-0">
        <div className="relative mt-1 grid place-items-center">
          <span className="absolute h-[clamp(64px,13dvh,112px)] w-[clamp(64px,13dvh,112px)] rounded-full bg-primary-soft" />
          <img
            src="/brand/badge-256.png"
            alt="NivoTalk"
            className="anim-pop relative h-[clamp(52px,10.5dvh,92px)] w-[clamp(52px,10.5dvh,92px)] rounded-full shadow-[0_8px_24px_rgba(90,111,208,0.35)]"
          />
          <svg className="anim-float absolute -left-12 top-2 text-primary [@media(max-height:620px)]:hidden" width="30" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 2.5C19.5 15.6 12 20 12 20Z" />
          </svg>
        </div>
        <h1 className="anim-rise mt-[clamp(6px,1.6dvh,16px)] text-center text-[clamp(24px,4.2dvh,40px)] leading-tight font-bold [@media(max-height:560px)]:hidden">
          Snap. Smile. Share.
        </h1>
        <p className="anim-rise delay-1 mt-1 max-w-xs text-center text-[clamp(13px,1.9dvh,16px)] text-muted [@media(max-height:700px)]:hidden">
          Capture your moments with NivoTalk — the perfect photobooth companion.
        </p>
        <div className="illus-wrap mt-2 flex min-h-0 w-full flex-1 items-end justify-center md:mt-6 md:h-[320px] md:flex-none">
          <BoothIllustration />
        </div>
      </section>

      {/* Form: bottom sheet on phones, card on desktop */}
      <section className="anim-sheet safe-bottom relative z-10 w-full shrink-0 rounded-t-[30px] bg-surface px-6 pt-5 pb-4 shadow-[0_-10px_40px_rgba(90,111,208,0.14)] md:max-w-md md:rounded-[30px] md:p-8 md:shadow-[var(--shadow)]">
        <div className="segmented mx-auto mb-4 flex w-full max-w-xs" role="tablist">
          {(['login', 'signup'] as const).map((t) => (
            <button key={t} role="tab" aria-pressed={tab === t} aria-selected={tab === t} className="flex-1" onClick={() => setTab(t)}>
              {t === 'login' ? 'Login' : 'Sign Up'}
            </button>
          ))}
        </div>
        {tab === 'login' ? <LoginForm onSwitch={() => setTab('signup')} /> : <SignupForm onSwitch={() => setTab('login')} />}
      </section>
    </div>
  );
}

function Blobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-24 -left-20 h-64 w-64 rounded-full bg-primary-soft opacity-70" />
      <div className="absolute top-1/3 -right-24 h-72 w-72 rounded-full bg-primary-soft opacity-60" />
    </div>
  );
}

function PasswordField({ value, onChange, autoComplete, placeholder = 'Password' }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <Icon name="lock" size={19} className="text-faint" />
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={128}
        required
      />
      <button type="button" className="text-faint hover:text-primary" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        <Icon name={show ? 'eye' : 'eyeOff'} size={19} />
      </button>
    </label>
  );
}

function Social({ onSwitch, label, action }: { onSwitch: () => void; label: string; action: string }) {
  const soon = () => toast('Coming soon ✨');
  return (
    <>
      <div className="my-3 flex items-center gap-3 text-xs font-semibold text-faint [@media(max-height:640px)]:hidden">
        <span className="h-px flex-1 bg-line" /> or continue with <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex justify-center gap-4 [@media(max-height:640px)]:hidden">
        <button type="button" onClick={soon} className="grid h-11 w-14 place-items-center rounded-2xl border border-line bg-surface" aria-label="Continue with Google">
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
        </button>
        <button type="button" onClick={soon} className="grid h-11 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink" aria-label="Continue with Apple">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.3-.1 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.3 3-2.5.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.3-4.2zM13.9 5c.7-.9 1.2-2 1-3.2-1 .1-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
          </svg>
        </button>
      </div>
      <p className="mt-3 text-center text-sm text-muted">
        {label}{' '}
        <button type="button" className="font-bold text-primary-strong" onClick={onSwitch}>
          {action}
        </button>
      </p>
    </>
  );
}

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const login = useAuth((s) => s.login);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(identifier.trim(), password, remember);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3">
      <label className="field">
        <Icon name="mail" size={19} className="text-faint" />
        <input
          placeholder="Email address or username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          maxLength={254}
          required
        />
      </label>
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="flex items-center justify-between px-1 text-sm">
        <label className="flex items-center gap-2 font-semibold text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-[18px] w-[18px] accent-[var(--primary)]" />
          Remember me
        </label>
        <button type="button" className="font-bold text-primary-strong" onClick={() => toast('Password reset is coming soon ✨')}>
          Forgot password?
        </button>
      </div>
      {error && <p className="anim-fade text-center text-sm font-semibold text-danger">{error}</p>}
      <button className="btn btn-primary mt-1 w-full" disabled={busy}>
        {busy ? 'Logging in…' : 'Log In'} <Icon name="arrowRight" size={19} />
      </button>
      <Social onSwitch={onSwitch} label="Don’t have an account?" action="Sign Up" />
    </form>
  );
}

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const STRENGTH = [
  { label: 'Too short', color: 'var(--danger)' },
  { label: 'Weak', color: '#f08a5d' },
  { label: 'Okay', color: '#f2c14e' },
  { label: 'Good', color: '#7cc47f' },
  { label: 'Strong', color: '#4fb286' },
];

function SignupForm({ onSwitch }: { onSwitch: () => void }) {
  const register = useAuth((s) => s.register);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState<Buddy>('dino');
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; reason?: string }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  // Live username check: debounced, and cancelled when you keep typing.
  useEffect(() => {
    const u = username.trim().toLowerCase();
    ctrl.current?.abort();
    if (!u) return setCheck({ state: 'idle' });
    if (!/^[a-z0-9._]{3,20}$/.test(u)) return setCheck({ state: 'bad', reason: '3–20 letters, numbers, dots or underscores' });
    setCheck({ state: 'checking' });
    const c = new AbortController();
    ctrl.current = c;
    const t = setTimeout(() => {
      api<{ available: boolean; reason?: string }>(`/auth/check-username?username=${encodeURIComponent(u)}`, { signal: c.signal })
        .then((r) => setCheck(r.available ? { state: 'ok' } : { state: 'bad', reason: r.reason }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [username]);

  const sc = password ? strength(password) : -1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register({ username: username.trim().toLowerCase(), email: email.trim(), password, avatar, remember: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2.5">
      <div>
        <label className="field">
          <span className="font-bold text-faint">@</span>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={20}
            required
          />
          {check.state === 'checking' && <span className="anim-spin h-4 w-4 rounded-full border-2 border-primary-soft border-t-primary" />}
          {check.state === 'ok' && <Icon name="check" size={19} className="text-[var(--success)]" />}
          {check.state === 'bad' && <Icon name="x" size={19} className="text-danger" />}
        </label>
        {check.state === 'bad' && check.reason && <p className="mt-1 px-4 text-xs font-semibold text-danger">{check.reason}</p>}
      </div>
      <label className="field">
        <Icon name="mail" size={19} className="text-faint" />
        <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} />
      </label>
      <div>
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" placeholder="Password (8+ characters)" />
        {sc >= 0 && (
          <div className="mt-1.5 flex items-center gap-2 px-4">
            <div className="flex flex-1 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: i < Math.max(1, sc) ? STRENGTH[sc].color : 'var(--line)' }} />
              ))}
            </div>
            <span className="w-16 text-right text-xs font-bold" style={{ color: STRENGTH[sc].color }}>
              {password.length < 8 ? STRENGTH[0].label : STRENGTH[sc].label}
            </span>
          </div>
        )}
      </div>
      <div>
        <p className="mb-1.5 px-1 text-sm font-bold text-muted">Pick your buddy</p>
        <div className="flex justify-between gap-1">
          {BUDDIES.map((b) => (
            <button
              type="button"
              key={b}
              onClick={() => setAvatar(b)}
              className={`flex flex-col items-center gap-0.5 rounded-2xl p-1 text-[11px] font-bold transition ${avatar === b ? 'bg-primary-soft text-primary-strong' : 'text-muted'}`}
              aria-pressed={avatar === b}
            >
              <span className={`rounded-full transition ${avatar === b ? 'scale-110 ring-2 ring-primary' : ''}`}>
                <BuddyAvatar buddy={b} size={42} />
              </span>
              {BUDDY_NAMES[b]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="anim-fade text-center text-sm font-semibold text-danger">{error}</p>}
      <button className="btn btn-primary mt-1 w-full" disabled={busy || check.state === 'bad' || password.length < 8}>
        {busy ? 'Creating account…' : 'Create account'} <Icon name="arrowRight" size={19} />
      </button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <button type="button" className="font-bold text-primary-strong" onClick={onSwitch}>
          Log In
        </button>
      </p>
    </form>
  );
}
