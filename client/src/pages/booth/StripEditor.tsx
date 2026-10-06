import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { SendToChat } from '../../components/SendToChat';
import { StickerPicker } from '../../components/StickerPicker';
import { toast } from '../../components/Toast';
import { api, errorText } from '../../lib/api';
import { canvasToBlob } from '../../lib/image';
import { downloadImage, shareImage } from '../../lib/share';
import { PACKS, stickerUrl } from '../../lib/stickers';
import type { Photo } from '../../lib/types';
import { composeStrip, FILTERS, FRAMES, PATTERNS, type Layout, type PlacedSticker, type Shots, type StripOptions } from './composer';

type Tab = 'layout' | 'frame' | 'filter' | 'stickers' | 'text';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'layout', label: 'Layout', icon: 'images' },
  { id: 'frame', label: 'Frame', icon: 'palette' },
  { id: 'filter', label: 'Filter', icon: 'sparkle' },
  { id: 'stickers', label: 'Stickers', icon: 'smile' },
  { id: 'text', label: 'Text', icon: 'edit' },
];

let keySeq = 0;
const newKey = () => `s${++keySeq}`;

export function StripEditor({ shots, names, roomCode, conversationId, onAgain, onLeave }: {
  shots: Shots;
  names: string[];
  roomCode: string;
  conversationId: number | null;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const [opts, setOpts] = useState<StripOptions>({
    layout: 'strip',
    frame: 'periwinkle',
    pattern: 'dots',
    filter: 'original',
    caption: '',
    showDate: true,
    names,
  });
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('layout');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ key: string; photo: Photo } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [aspect, setAspect] = useState(0.5);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Identifies the current edit; an upload is reused until something changes.
  const editKey = useMemo(() => JSON.stringify([opts, stickers]), [opts, stickers]);

  const set = (patch: Partial<StripOptions>) => setOpts((o) => ({ ...o, ...patch }));

  // Live preview: strip on canvas, stickers as movable DOM overlays.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    composeStrip(c, shots, opts).then(() => setAspect(c.width / c.height));
  }, [shots, opts]);

  function decorate() {
    const pack = PACKS[Math.floor(Math.random() * PACKS.length)];
    const pick = [...pack.stickers].sort(() => Math.random() - 0.5).slice(0, 5);
    const spots = [
      [0.14, 0.06], [0.86, 0.1], [0.1, 0.5], [0.9, 0.62], [0.82, 0.9],
    ];
    setStickers(pick.map((s, i) => ({ key: newKey(), id: s.id, x: spots[i][0], y: spots[i][1], scale: 0.2 + Math.random() * 0.06, rot: Math.round((Math.random() - 0.5) * 36) })));
    toast(`${pack.name} decorated your strip ✨`);
  }

  function addSticker(id: string) {
    const s: PlacedSticker = { key: newKey(), id, x: 0.5, y: 0.45 + Math.random() * 0.1, scale: 0.24, rot: Math.round((Math.random() - 0.5) * 20) };
    setStickers((list) => [...list, s]);
    setSelected(s.key);
  }

  async function exportBlob() {
    const c = document.createElement('canvas');
    await composeStrip(c, shots, opts, stickers);
    return canvasToBlob(c, 'image/jpeg', 0.92);
  }

  /** Uploads the current version once; later actions reuse it until something changes. */
  async function ensureSaved(): Promise<Photo> {
    if (saved && saved.key === editKey) return saved.photo;
    const blob = await exportBlob();
    const { photo } = await api<{ photo: Photo }>(`/photos?roomCode=${roomCode}`, { raw: blob });
    setSaved({ key: editKey, photo });
    return photo;
  }

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

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex h-full flex-col bg-bg md:flex-row">
      {/* Preview */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="safe-top flex items-center justify-between px-3 py-2">
          <button className="btn btn-ghost btn-sm" onClick={onLeave}>
            <Icon name="back" size={18} /> Leave
          </button>
          <span className="font-display text-lg font-semibold">Your strip</span>
          <button className="btn btn-soft btn-sm" onClick={onAgain}>
            <Icon name="camera" size={17} /> Again
          </button>
        </div>
        <div className="grid min-h-0 flex-1 place-items-center p-3" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div
            ref={stageRef}
            className="anim-pop relative max-h-full max-w-full overflow-hidden rounded-xl shadow-[0_16px_40px_rgba(35,44,92,0.25)]"
            style={{ aspectRatio: `${aspect}`, height: aspect < 0.8 ? '100%' : undefined, width: aspect >= 0.8 ? '100%' : undefined }}
          >
            <canvas ref={canvasRef} className="block h-full w-full" />
            {stickers.map((s) => (
              <StickerOverlay
                key={s.key}
                s={s}
                stage={stageRef}
                selected={selected === s.key}
                onSelect={() => setSelected(s.key)}
                onChange={(p) => setStickers((list) => list.map((x) => (x.key === s.key ? { ...x, ...p } : x)))}
                onRemove={() => setStickers((list) => list.filter((x) => x.key !== s.key))}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="safe-bottom shrink-0 border-t border-line bg-surface md:w-[380px] md:border-t-0 md:border-l">
        <div className="flex border-b border-line px-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold transition ${tab === t.id ? 'text-primary-strong' : 'text-faint'}`}
            >
              <Icon name={t.icon} size={20} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="scroll-thin h-[188px] overflow-y-auto p-3 md:h-auto md:max-h-[calc(100dvh-210px)]">
          {tab === 'layout' && (
            <div className="grid grid-cols-3 gap-2">
              {(['strip', 'grid', 'double'] as Layout[]).map((l) => (
                <button key={l} onClick={() => set({ layout: l })} className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-sm font-bold capitalize transition ${opts.layout === l ? 'border-primary bg-primary-soft text-primary-strong' : 'border-line text-muted'}`}>
                  <LayoutGlyph layout={l} />
                  {l}
                </button>
              ))}
            </div>
          )}
          {tab === 'frame' && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {FRAMES.map((f) => (
                  <button key={f.id} onClick={() => set({ frame: f.id })} title={f.name} aria-label={f.name} className={`h-10 w-10 rounded-xl border border-line transition ${opts.frame === f.id ? 'scale-110 ring-[3px] ring-primary ring-offset-2 ring-offset-surface' : ''}`} style={{ background: `linear-gradient(135deg, ${f.bg} 60%, ${f.accent} 60%)` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PATTERNS.map((p) => (
                  <button key={p.id} className="chip" aria-pressed={opts.pattern === p.id} onClick={() => set({ pattern: p.id })}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tab === 'filter' && (
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f.id} className="chip" aria-pressed={opts.filter === f.id} onClick={() => set({ filter: f.id })}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {tab === 'stickers' && (
            <div className="-mx-3 -mt-3">
              <div className="flex gap-2 px-3 pt-2">
                <button className="btn btn-soft btn-sm flex-1" onClick={decorate}>
                  <Icon name="wand" size={17} /> Decorate
                </button>
                <button className="btn btn-ghost btn-sm" disabled={!stickers.length} onClick={() => setStickers([])}>
                  Clear
                </button>
              </div>
              <StickerPicker onPick={addSticker} height={150} />
            </div>
          )}
          {tab === 'text' && (
            <div className="grid gap-2">
              <label className="field h-11">
                <Icon name="edit" size={18} className="text-faint" />
                <input placeholder="Caption (e.g. best day ever!)" maxLength={40} value={opts.caption} onChange={(e) => set({ caption: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 px-1 text-sm font-semibold text-muted">
                <input type="checkbox" checked={opts.showDate} onChange={(e) => set({ showDate: e.target.checked })} className="h-[18px] w-[18px] accent-[var(--primary)]" />
                Add the date
              </label>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-line p-3">
          <button
            className="btn btn-soft btn-sm"
            disabled={busy}
            onClick={run(async () => {
              await ensureSaved();
              toast('Saved to Memories 💾');
            })}
          >
            <Icon name="images" size={17} /> Save
          </button>
          <button
            className="btn btn-soft btn-sm"
            disabled={busy}
            onClick={run(async () => {
              const blob = await exportBlob();
              await shareImage(blob, `nivotalk-${stamp}.jpg`, 'Our NivoTalk strip').catch(() => downloadImage(blob, `nivotalk-${stamp}.jpg`));
            })}
          >
            <Icon name="download" size={17} /> Share
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={run(async () => {
              await ensureSaved();
              setSendOpen(true);
            })}
          >
            <Icon name="send" size={17} /> Chat
          </button>
        </div>
      </div>
      <SendToChat open={sendOpen} onClose={() => setSendOpen(false)} photoId={saved?.photo.id ?? null} defaultConversationId={conversationId} />
    </div>
  );
}

function LayoutGlyph({ layout }: { layout: Layout }) {
  const cell = 'rounded-[3px] bg-current opacity-60';
  if (layout === 'grid')
    return (
      <span className="grid h-10 w-9 grid-cols-2 gap-[3px] rounded-md border-2 border-current p-[3px]">
        {[0, 1, 2, 3].map((i) => <i key={i} className={cell} />)}
      </span>
    );
  const one = (
    <span className="grid h-10 w-[18px] gap-[3px] rounded-md border-2 border-current p-[3px]">
      {[0, 1, 2].map((i) => <i key={i} className={cell} />)}
    </span>
  );
  return layout === 'double' ? <span className="flex gap-1">{one}{one}</span> : one;
}

/** A sticker on the strip: drag to move, corner handle to resize & rotate, × to remove. */
function StickerOverlay({ s, stage, selected, onSelect, onChange, onRemove }: {
  s: PlacedSticker;
  stage: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
  onSelect: () => void;
  onChange: (p: Partial<PlacedSticker>) => void;
  onRemove: () => void;
}) {
  function startDrag(e: RPointerEvent) {
    e.stopPropagation();
    onSelect();
    const box = stage.current!.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, x: s.x, y: s.y };
    const move = (ev: PointerEvent) =>
      onChange({
        x: Math.min(1, Math.max(0, start.x + (ev.clientX - start.px) / box.width)),
        y: Math.min(1, Math.max(0, start.y + (ev.clientY - start.py) / box.height)),
      });
    track(move);
  }

  function startTransform(e: RPointerEvent) {
    e.stopPropagation();
    const box = stage.current!.getBoundingClientRect();
    const cx = box.left + s.x * box.width;
    const cy = box.top + s.y * box.height;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy);
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const start = { scale: s.scale, rot: s.rot };
    track((ev) => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      onChange({ scale: Math.min(0.9, Math.max(0.06, (start.scale * d) / d0)), rot: Math.round(start.rot + ((a - a0) * 180) / Math.PI) });
    });
  }

  return (
    <div
      className="absolute touch-none select-none"
      style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.scale * 100}%`, transform: `translate(-50%, -50%) rotate(${s.rot}deg)` }}
      onPointerDown={startDrag}
    >
      <img src={stickerUrl(s.id)} alt="" className={`block w-full cursor-grab drop-shadow-md ${selected ? 'outline-2 outline-offset-2 outline-dashed outline-white' : ''}`} draggable={false} />
      {selected && (
        <>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} className="absolute -top-3 -left-3 grid h-7 w-7 place-items-center rounded-full bg-danger text-white shadow" aria-label="Remove sticker">
            <Icon name="x" size={14} strokeWidth={3} />
          </button>
          <span onPointerDown={startTransform} className="absolute -right-3 -bottom-3 grid h-7 w-7 cursor-nwse-resize place-items-center rounded-full bg-primary text-white shadow" aria-label="Resize and rotate">
            <Icon name="rotate" size={14} strokeWidth={2.6} />
          </span>
        </>
      )}
    </div>
  );
}

function track(move: (e: PointerEvent) => void) {
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
