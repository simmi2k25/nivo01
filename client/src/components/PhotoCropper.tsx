import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { canvasToBlob } from '../lib/image';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const VIEW = 280; // on-screen crop square, CSS px
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number };

/** Drag and zoom a photo inside a circle before it becomes the profile picture. Returns a square JPEG. */
export function PhotoCropper({
  file,
  onCancel,
  onDone,
  size = 640,
}: {
  file: File | null;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  size?: number;
}) {
  // The decoded photo, tagged with its file so a closed bitmap from an earlier pick is never drawn.
  const [loadedImg, setLoadedImg] = useState<{ file: File; bmp: ImageBitmap } | null>(null);
  const bitmap = loadedImg && loadedImg.file === file ? loadedImg.bmp : null;
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    let bmp: ImageBitmap | null = null;
    setView({ zoom: 1, x: 0, y: 0 });
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        bmp = b;
        if (alive) setLoadedImg({ file, bmp: b });
        else b.close();
      })
      .catch(() => alive && onCancel());
    return () => {
      alive = false;
      bmp?.close();
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scale at zoom 1: the photo just covers the square.
  const base = bitmap ? VIEW / Math.min(bitmap.width, bitmap.height) : 1;

  /** Keeps the photo covering the whole square, whatever the zoom. */
  function clamp(v: View): View {
    if (!bitmap) return v;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    const w = bitmap.width * base * zoom;
    const h = bitmap.height * base * zoom;
    const mx = (w - VIEW) / 2;
    const my = (h - VIEW) / 2;
    return { zoom, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  }

  function draw(ctx: CanvasRenderingContext2D, out: number, v: View) {
    if (!bitmap) return;
    const k = out / VIEW;
    const w = bitmap.width * base * v.zoom * k;
    const h = bitmap.height * base * v.zoom * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, out / 2 - w / 2 + v.x * k, out / 2 - h / 2 + v.y * k, w, h);
  }

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(VIEW * dpr);
    if (c.width !== px) c.width = c.height = px;
    draw(c.getContext('2d')!, px, view);
  }); // redraw on every render — cheap, and always in sync

  const zoomTo = (zoom: number) => setView((v) => clamp({ ...v, zoom }));

  function onDown(e: ReactPointerEvent) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer already lifted */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  }

  function onMove(e: ReactPointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const p = pinch.current;
      setView((v) => clamp({ ...v, zoom: (p.zoom * dist) / p.dist }));
    } else {
      setView((v) => clamp({ ...v, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y }));
    }
  }

  function onUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  async function confirm() {
    if (!bitmap) return;
    setBusy(true);
    try {
      const out = document.createElement('canvas');
      out.width = out.height = size;
      draw(out.getContext('2d')!, size, view);
      onDone(await canvasToBlob(out, 'image/jpeg', 0.9));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!file} onClose={onCancel} title="Adjust photo">
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative cursor-grab touch-none overflow-hidden rounded-2xl bg-surface-2 select-none active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={(e) => zoomTo(view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          <canvas ref={canvas} className="block h-full w-full" aria-label="Photo preview — drag to move, pinch to zoom" />
          {/* Dim everything outside the circle your friends will see. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(20,24,52,0.5)] ring-2 ring-white/90" />
          {!bitmap && <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-muted">Opening…</div>}
        </div>
        <div className="flex w-full max-w-[280px] items-center gap-3">
          <Icon name="image" size={16} className="shrink-0 text-muted" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="flex-1 accent-[var(--primary)]"
            aria-label="Zoom"
          />
          <Icon name="image" size={22} className="shrink-0 text-muted" />
        </div>
        <p className="-mt-2 text-xs text-muted">Drag to move · pinch or slide to zoom</p>
        <div className="grid w-full grid-cols-2 gap-2">
          <button className="btn btn-soft" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={!bitmap || busy}>
            <Icon name="check" size={19} /> Use photo
          </button>
        </div>
      </div>
    </Sheet>
  );
}
