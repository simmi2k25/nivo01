import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, errorText } from '../lib/api';
import { listStamp } from '../lib/format';
import { stickerUrl } from '../lib/stickers';
import {
  artPoints,
  DEFAULT_STYLE,
  EMPTY_ART,
  MAX_POINTS,
  PEN_COLORS,
  PEN_WIDTHS,
  STATUS_BGS,
  STATUS_FONTS,
  statusFontSize,
  statusLook,
  type PlacedSticker,
  type StatusArt,
  type StatusBg,
  type StatusFont,
  type StatusStroke,
  type StatusStyle,
} from '../lib/statusStyles';
import type { Status, User } from '../lib/types';
import { useAuth } from '../stores/auth';
import { useStatus } from '../stores/status';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { StickerPicker } from './StickerPicker';
import { toast } from './Toast';

const MAX = 300;
const STYLE_KEY = 'nivo:status-style';
/** Statuses are laid out on a phone-shaped stage so drawings and stickers land in the same place on every screen. */
const STAGE = 'relative mx-auto h-full w-full max-w-[520px]';

function lastStyle(): StatusStyle {
  try {
    return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_STYLE;
  }
}

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

function strokePath(p: number[]) {
  if (p.length < 2) return '';
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  // A single tap draws a dot.
  return p.length === 2 ? `${d}L${p[0]} ${p[1]}` : d;
}

/** The pen drawing and stickers, drawn over a status. */
function ArtLayer({
  art,
  live,
  selected,
  onStickerDown,
}: {
  art: Partial<StatusArt> | undefined;
  live?: StatusStroke | null;
  selected?: number | null;
  onStickerDown?: (i: number, e: ReactPointerEvent<HTMLImageElement>) => void;
}) {
  const strokes = [...(art?.strokes ?? []), ...(live ? [live] : [])];
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {strokes.map((s, i) => (
          <path key={i} d={strokePath(s.p)} stroke={s.c} strokeWidth={s.w} vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {(art?.stickers ?? []).map((st, i) => (
        <img
          key={i}
          src={stickerUrl(st.id)}
          alt=""
          draggable={false}
          onPointerDown={onStickerDown ? (e) => onStickerDown(i, e) : undefined}
          className={`absolute touch-none drop-shadow-md select-none ${onStickerDown ? 'cursor-grab' : 'pointer-events-none'} ${selected === i ? 'rounded-2xl outline-2 outline-offset-4 outline-white/80 outline-dashed' : ''}`}
          style={{ left: `${st.x * 100}%`, top: `${st.y * 100}%`, width: `${st.s * 100}%`, transform: `translate(-50%, -50%) rotate(${st.r}deg)` }}
        />
      ))}
    </>
  );
}

type Mode = 'text' | 'draw' | 'sticker';

/** Full-screen editor: type a message, draw with a pen, add stickers, pick a background and font, then post. */
export function StatusComposer() {
  const open = useStatus((s) => s.composing);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<StatusStyle>(lastStyle);
  const [art, setArt] = useState<StatusArt>(EMPTY_ART);
  const [mode, setMode] = useState<Mode>('text');
  const [pen, setPen] = useState({ c: PEN_COLORS[0], w: PEN_WIDTHS[1] });
  const [live, setLive] = useState<StatusStroke | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; dx: number; dy: number } | null>(null);
  const close = () => useStatus.setState({ composing: false });

  useEffect(() => {
    if (!open) return;
    setText('');
    setArt(EMPTY_ART);
    setMode('text');
    setSelected(null);
    setTimeout(() => input.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const look = statusLook(style);
  const patch = (p: Partial<StatusStyle>) =>
    setStyle((s) => {
      const next = { ...s, ...p };
      try {
        localStorage.setItem(STYLE_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  const fonts = Object.keys(STATUS_FONTS) as StatusFont[];
  const nextFont = () => patch({ font: fonts[(fonts.indexOf(style.font) + 1) % fonts.length] });
  const nextSize = () => patch({ size: style.size === 's' ? 'm' : style.size === 'm' ? 'l' : 's' });
  const empty = !text.trim() && !art.strokes.length && !art.stickers.length;

  /** Pointer position as 0–1 fractions of the stage. */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)] as const;
  };

  // ---- pen ----
  function penDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (artPoints(art) >= MAX_POINTS) return toast('That’s a lot of drawing — undo a stroke to keep going');
    const [x, y] = at(e);
    setLive({ c: pen.c, w: pen.w, p: [x, y] });
  }
  function penMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!live) return;
    const [x, y] = at(e);
    const p = live.p;
    const dx = x - p[p.length - 2];
    const dy = y - p[p.length - 1];
    if (dx * dx + dy * dy < 0.003 * 0.003 || p.length >= 2000 || artPoints(art) + p.length >= MAX_POINTS) return;
    setLive({ ...live, p: [...p, x, y] });
  }
  function penUp() {
    if (live) setArt((a) => ({ ...a, strokes: [...a.strokes, live] }));
    setLive(null);
  }

  // ---- stickers ----
  function addSticker(id: string) {
    if (art.stickers.length >= 20) return toast('That’s the most stickers one status can hold');
    const st: PlacedSticker = { id, x: 0.5, y: 0.42, s: 0.34, r: Math.round(Math.random() * 16 - 8) };
    setArt((a) => ({ ...a, stickers: [...a.stickers, st] }));
    setSelected(art.stickers.length);
    setMode('text');
  }
  function stickerDown(i: number, e: ReactPointerEvent<HTMLImageElement>) {
    if (mode === 'draw') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(i);
    const [x, y] = at(e);
    drag.current = { i, dx: art.stickers[i].x - x, dy: art.stickers[i].y - y };
  }
  function stickerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const [x, y] = at(e);
    setArt((a) => ({ ...a, stickers: a.stickers.map((s, k) => (k === d.i ? { ...s, x: round(x + d.dx), y: round(y + d.dy) } : s)) }));
  }
  const editSticker = (fn: (s: PlacedSticker) => PlacedSticker) =>
    selected !== null && setArt((a) => ({ ...a, stickers: a.stickers.map((s, k) => (k === selected ? fn(s) : s)) }));
  const removeSticker = () => {
    if (selected === null) return;
    setArt((a) => ({ ...a, stickers: a.stickers.filter((_, k) => k !== selected) }));
    setSelected(null);
  };

  async function post() {
    if (empty) return;
    setBusy(true);
    try {
      await useStatus.getState().post(text.trim(), style, art);
      toast('Status posted ✨');
      close();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const chip = 'grid h-11 min-w-11 shrink-0 place-items-center rounded-full bg-black/20 px-3 text-sm font-extrabold backdrop-blur transition active:scale-90';
  const on = 'bg-white !text-[#232c5c]';

  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 transition-[background] duration-500" style={{ background: look.background, color: look.color }} role="dialog" aria-modal="true" aria-label="New status">
      <div
        ref={stage}
        className={`${STAGE} flex flex-col`}
        onPointerMove={stickerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerDown={() => mode === 'text' && setSelected(null)}
      >
        {/* message */}
        <div className="absolute inset-0 grid place-items-center px-7">
          <textarea
            ref={input}
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'draw' ? '' : 'Type a status'}
            rows={4}
            className={`w-full resize-none bg-transparent text-center leading-tight outline-none placeholder:opacity-60 ${mode === 'draw' ? 'pointer-events-none' : ''}`}
            style={{ fontFamily: look.fontFamily, fontWeight: look.fontWeight, fontSize: statusFontSize(style, text || 'Type a status'), color: look.color, caretColor: look.color }}
          />
        </div>

        <ArtLayer art={art} live={live} selected={mode === 'draw' ? null : selected} onStickerDown={stickerDown} />

        {/* while the pen is on, the whole stage is a canvas */}
        {mode === 'draw' && <div className="absolute inset-0 touch-none" onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp} />}

        {/* top bar */}
        <div className="safe-top relative z-10 flex items-center gap-2 px-3 pt-3" onPointerDown={(e) => e.stopPropagation()}>
          <button className={chip} onClick={close} aria-label="Close">
            <Icon name="x" size={22} />
          </button>
          <div className="flex-1" />
          {selected !== null && mode !== 'draw' ? (
            <>
              <button className={chip} onClick={() => editSticker((s) => ({ ...s, s: Math.max(0.08, round(s.s * 0.85)) }))} aria-label="Smaller sticker">
                <Icon name="minus" size={20} />
              </button>
              <button className={chip} onClick={() => editSticker((s) => ({ ...s, s: Math.min(0.9, round(s.s * 1.18)) }))} aria-label="Bigger sticker">
                <Icon name="plus" size={20} />
              </button>
              <button className={chip} onClick={() => editSticker((s) => ({ ...s, r: ((s.r + 15 + 180) % 360) - 180 }))} aria-label="Rotate sticker">
                <Icon name="rotate" size={20} />
              </button>
              <button className={chip} onClick={removeSticker} aria-label="Remove sticker">
                <Icon name="trash" size={19} />
              </button>
              <button className={`${chip} ${on}`} onClick={() => setSelected(null)}>
                Done
              </button>
            </>
          ) : (
            <>
              {mode !== 'draw' && (
                <>
                  <button className={chip} onClick={nextSize} aria-label="Text size" title="Text size">
                    <span>
                      <span style={{ fontSize: { s: 13, m: 16, l: 20 }[style.size] }}>A</span>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>A</span>
                    </span>
                  </button>
                  <button className={chip} onClick={nextFont} aria-label={`Font: ${STATUS_FONTS[style.font].label}`} title="Change font">
                    <span style={{ fontFamily: look.fontFamily, fontWeight: look.fontWeight }}>Aa</span>
                  </button>
                </>
              )}
              <button className={`${chip} ${mode === 'draw' ? on : ''}`} onClick={() => setMode(mode === 'draw' ? 'text' : 'draw')} aria-pressed={mode === 'draw'} aria-label="Draw with the pen" title="Pen">
                <Icon name="pen" size={20} />
              </button>
              <button className={`${chip} ${mode === 'sticker' ? on : ''}`} onClick={() => setMode(mode === 'sticker' ? 'text' : 'sticker')} aria-pressed={mode === 'sticker'} aria-label="Add a sticker" title="Stickers">
                <Icon name="smile" size={21} />
              </button>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* bottom bar */}
        <div className="safe-bottom relative z-10 px-3 pb-4" onPointerDown={(e) => e.stopPropagation()}>
          {mode === 'draw' ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex w-full items-center justify-center gap-2.5 py-1" role="radiogroup" aria-label="Pen colour">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={pen.c === c}
                    aria-label={`Pen colour ${c}`}
                    onClick={() => setPen((p) => ({ ...p, c }))}
                    className={`h-8 w-8 shrink-0 rounded-full ring-2 transition ${pen.c === c ? 'scale-115 ring-white' : 'ring-white/40'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mr-auto flex shrink-0 items-center gap-1 rounded-full bg-black/20 p-1" role="radiogroup" aria-label="Pen size">
                {PEN_WIDTHS.map((w) => (
                  <button key={w} role="radio" aria-checked={pen.w === w} aria-label={`Pen size ${w}`} onClick={() => setPen((p) => ({ ...p, w }))} className={`grid h-9 w-9 place-items-center rounded-full ${pen.w === w ? 'bg-white/90' : ''}`}>
                    <span className="block rounded-full" style={{ width: Math.min(20, w + 2), height: Math.min(20, w + 2), background: pen.w === w ? '#232c5c' : pen.c }} />
                  </button>
                ))}
              </div>
              <button className={chip} onClick={() => setArt((a) => ({ ...a, strokes: a.strokes.slice(0, -1) }))} disabled={!art.strokes.length} aria-label="Undo last stroke">
                <Icon name="undo" size={20} />
              </button>
              <button className={`${chip} ${on}`} onClick={() => setMode('text')}>
                Done
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 [scrollbar-width:none]" role="radiogroup" aria-label="Background">
                {(Object.keys(STATUS_BGS) as StatusBg[]).map((bg) => (
                  <button
                    key={bg}
                    role="radio"
                    aria-checked={style.bg === bg}
                    aria-label={bg}
                    onClick={() => patch({ bg })}
                    className={`h-9 w-9 shrink-0 rounded-full ring-2 transition ${style.bg === bg ? 'scale-110 ring-white' : 'ring-white/40'}`}
                    style={{ background: STATUS_BGS[bg].bg }}
                  />
                ))}
              </div>
              <span className="shrink-0 text-xs font-bold opacity-75 tabular-nums">{MAX - text.length}</span>
              <button
                className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-primary-strong shadow-lg transition active:scale-90 disabled:opacity-50"
                onClick={post}
                disabled={busy || empty}
                aria-label="Post status"
              >
                {busy ? <span className="anim-spin h-5 w-5 rounded-full border-2 border-primary-soft border-t-primary" /> : <Icon name="send" size={24} />}
              </button>
            </div>
          )}
        </div>

        {/* sticker drawer */}
        {mode === 'sticker' && (
          <div className="anim-sheet absolute inset-x-0 bottom-0 z-20 rounded-t-[28px] bg-surface pt-2 text-ink shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pb-1">
              <b>Add a sticker</b>
              <button className="icon-btn -mr-2" onClick={() => setMode('text')} aria-label="Close stickers">
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="safe-bottom">
              <StickerPicker onPick={addSticker} height={300} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const SHOW_MS = 6000;

/** Full-screen story viewer: tap left/right to move, hold to pause, auto-advances. */
export function StatusViewer() {
  const me = useAuth((s) => s.user);
  const viewing = useStatus((s) => s.viewing);
  const groups = useStatus((s) => s.groups);
  const group = groups.find((g) => g.user.id === viewing) ?? null;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewers, setViewers] = useState<Status | null>(null);

  const list = group?.statuses ?? [];
  const close = () => useStatus.setState({ viewing: null });

  // Open on the first one you haven't seen.
  useEffect(() => {
    if (!viewing) return;
    const g = useStatus.getState().groups.find((x) => x.user.id === viewing);
    const first = g?.statuses.findIndex((s) => !s.seen) ?? -1;
    setI(first >= 0 ? first : 0);
    setElapsed(0);
  }, [viewing]);

  const current = list[Math.min(i, list.length - 1)];
  useEffect(() => {
    if (current) useStatus.getState().markViewed(current);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moves to the next person's statuses after the last one.
  const next = () => {
    if (i < list.length - 1) {
      setI(i + 1);
      setElapsed(0);
      return;
    }
    const idx = groups.findIndex((g) => g.user.id === viewing);
    const after = groups.slice(idx + 1).find((g) => g.user.id !== me?.id);
    if (after) useStatus.setState({ viewing: after.user.id });
    else close();
  };
  const prev = () => {
    setI(Math.max(0, i - 1));
    setElapsed(0);
  };

  useEffect(() => {
    if (!viewing || paused || viewers) return;
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, [viewing, paused, viewers]);
  useEffect(() => {
    if (elapsed >= SHOW_MS) next();
  }, [elapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Their statuses expired or were deleted while open.
  useEffect(() => {
    if (viewing && useStatus.getState().loaded && !group) close();
  }, [viewing, group]);

  if (!viewing || !group || !current) return null;
  const look = statusLook(current.style);
  const mine = group.user.id === me?.id;

  async function remove() {
    if (!confirm('Delete this status?')) return;
    try {
      await useStatus.getState().remove(current.id);
      if (list.length <= 1) close();
      else setI(Math.max(0, i - 1));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 select-none" style={{ background: look.background, color: look.color }} role="dialog" aria-modal="true" aria-label={`${group.user.displayName}’s status`}>
      <div className={`${STAGE} flex flex-col`}>
        {/* message, drawing and stickers; tap left third to go back, the rest to go forward, hold to pause */}
        <div className="absolute inset-0" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
          {current.text && (
            <div className="absolute inset-0 grid place-items-center px-8">
              <p
                className="anim-pop text-center leading-tight break-words whitespace-pre-wrap"
                style={{ fontFamily: look.fontFamily, fontWeight: look.fontWeight, fontSize: statusFontSize(look.style, current.text), textShadow: '0 1px 12px rgba(0,0,0,0.12)' }}
              >
                {current.text}
              </p>
            </div>
          )}
          <ArtLayer art={current.art} />
          <button className="absolute inset-y-0 left-0 w-1/3" onClick={prev} aria-label="Previous status" />
          <button className="absolute inset-y-0 right-0 w-2/3" onClick={next} aria-label="Next status" />
        </div>

        <div className="safe-top relative z-10 px-3 pt-2">
          <div className="flex gap-1">
            {list.map((s, k) => (
              <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full bg-white" style={{ width: k < i ? '100%' : k === i ? `${Math.min(100, (elapsed / SHOW_MS) * 100)}%` : '0%' }} />
              </span>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <Avatar user={group.user} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{mine ? 'My status' : group.user.displayName}</span>
              <span className="block text-xs font-semibold opacity-80">{listStamp(current.createdAt)}</span>
            </span>
            {mine && (
              <button className="grid h-10 w-10 place-items-center rounded-full bg-black/20" onClick={remove} aria-label="Delete this status">
                <Icon name="trash" size={19} />
              </button>
            )}
            <button className="grid h-10 w-10 place-items-center rounded-full bg-black/20" onClick={close} aria-label="Close">
              <Icon name="x" size={21} />
            </button>
          </div>
        </div>

        <div className="flex-1" />

        {mine && (
          <div className="safe-bottom relative z-10 flex justify-center pb-5">
            <button className="flex items-center gap-2 rounded-full bg-black/20 px-5 py-2.5 text-sm font-extrabold backdrop-blur" onClick={() => setViewers(current)}>
              <Icon name="eye" size={18} /> {current.views} {current.views === 1 ? 'view' : 'views'}
            </button>
          </div>
        )}
      </div>
      {viewers && <ViewersSheet status={viewers} onClose={() => setViewers(null)} />}
    </div>,
    document.body,
  );
}

function ViewersSheet({ status, onClose }: { status: Status; onClose: () => void }) {
  const [list, setList] = useState<{ user: User; viewedAt: string }[] | null>(null);
  useEffect(() => {
    api<{ viewers: { user: User; viewedAt: string }[] }>(`/statuses/${status.id}/views`)
      .then((r) => setList(r.viewers))
      .catch(() => setList([]));
  }, [status.id]);
  return (
    <Sheet open onClose={onClose} title="Seen by">
      {list === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {list?.length === 0 && <p className="py-6 text-center text-sm text-muted">No one has seen it yet.</p>}
      <div className="grid gap-1 text-ink">
        {list?.map((v) => (
          <div key={v.user.id} className="flex items-center gap-3 rounded-2xl px-1 py-1.5">
            <Avatar user={v.user} size={40} />
            <span className="min-w-0 flex-1 truncate font-bold">{v.user.displayName}</span>
            <span className="text-xs font-semibold text-faint">{listStamp(v.viewedAt)}</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Ring around an avatar: bright when there's something new, grey once seen, dashed when there's no status. */
export function StatusRing({ state, children }: { state: 'new' | 'seen' | 'none' | 'online' | 'favorite'; children: React.ReactNode }) {
  if (state === 'new') {
    return (
      <span className="rounded-full bg-[conic-gradient(from_200deg,#f59ab8,#a08ae0,#6f84de,#5bb3ea,#f59ab8)] p-[3px]">
        <span className="block rounded-full bg-surface p-[2px]">{children}</span>
      </span>
    );
  }
  if (state === 'seen') return <span className="rounded-full border-[3px] border-line p-[2px]">{children}</span>;
  const color = state === 'online' ? 'border-[var(--online)]' : state === 'favorite' ? 'border-[#f2b33d]' : 'border-faint';
  return <span className={`rounded-full border-2 border-dashed p-[3px] ${color}`}>{children}</span>;
}
