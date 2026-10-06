import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { canvasToBlob, loadImage } from '../lib/image';
import { publicOrigin } from '../lib/native';
import { getPref, setPref } from '../lib/prefs';
import { copyText, downloadImage, shareImage } from '../lib/share';
import { BUDDY_STICKER, BUDDY_TINT, stickerUrl } from '../lib/stickers';
import type { User } from '../lib/types';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { toast } from './Toast';

const COLORS = [
  { id: 'periwinkle', c: '#6f84de' },
  { id: 'midnight', c: '#232c5c' },
  { id: 'blush', c: '#f2a7ba' },
  { id: 'lilac', c: '#b4a2ee' },
  { id: 'sky', c: '#86c1ee' },
  { id: 'mint', c: '#8fd3b6' },
  { id: 'butter', c: '#f6c453' },
  { id: 'peach', c: '#f7a580' },
];

const W = 1080;
const H = 1440;

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws the QR ID card on a 1080×1440 canvas. The QR stays dark-on-white so any scanner reads it. */
export async function drawQrCard(canvas: HTMLCanvasElement, user: User, color: string) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await Promise.all(['700 64px Pacifico', '600 56px Fredoka', '700 40px Nunito'].map((f) => document.fonts.load(f).catch(() => {})));
  const light = luminance(color) > 0.45;
  const ink = light ? '#232c5c' : '#ffffff';

  // Background with soft circles
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(color, 0.08));
  g.addColorStop(1, shade(color, -0.08));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (const [x, y, r] of [[60, 120, 220], [1000, 260, 160], [980, 1320, 260], [80, 1260, 140]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wordmark
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = '64px Pacifico, cursive';
  ctx.fillText('NivoTalk', W / 2, 150);

  // Card
  const cx = 120, cy = 220, cw = W - 240, ch = 1020;
  ctx.save();
  ctx.shadowColor = 'rgba(20,24,60,0.25)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx, cy, cw, ch, 56);
  ctx.fill();
  ctx.restore();

  // Avatar
  const av = 150;
  const ax = W / 2 - av / 2;
  const ay = cy + 56;
  ctx.save();
  roundRect(ctx, ax, ay, av, av, 44);
  ctx.clip();
  try {
    if (user.avatarUrl) {
      const img = await loadImage(user.avatarUrl);
      ctx.drawImage(img, ax, ay, av, av);
    } else {
      ctx.fillStyle = BUDDY_TINT[user.avatar] ?? '#e4e9fb';
      ctx.fillRect(ax, ay, av, av);
      const img = await loadImage(stickerUrl(BUDDY_STICKER[user.avatar] ?? 'dino-01'));
      const s = av * 0.86;
      const r = Math.min(s / img.width, s / img.height);
      ctx.drawImage(img, W / 2 - (img.width * r) / 2, ay + av / 2 - (img.height * r) / 2, img.width * r, img.height * r);
    }
  } catch {
    /* draw without avatar */
  }
  ctx.restore();

  ctx.fillStyle = '#232c5c';
  ctx.font = '600 56px Fredoka, Nunito, sans-serif';
  ctx.fillText(user.displayName.slice(0, 24), W / 2, ay + av + 78);
  ctx.fillStyle = '#7d88bb';
  ctx.font = '700 36px Nunito, sans-serif';
  ctx.fillText(`@${user.username}`, W / 2, ay + av + 126);

  // QR (error correction H: ~30% can be covered by the logo)
  const qr = QRCode.create(`${publicOrigin()}/u/${user.username}`, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const size = 600;
  const qx = W / 2 - size / 2;
  const qy = ay + av + 170;
  const m = size / n;
  const logoModules = Math.ceil(n * 0.24);
  const lo = Math.floor((n - logoModules) / 2);
  const isFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  ctx.fillStyle = '#232c5c';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c) || isFinder(r, c)) continue;
      if (r >= lo && r < lo + logoModules && c >= lo && c < lo + logoModules) continue;
      ctx.beginPath();
      ctx.arc(qx + c * m + m / 2, qy + r * m + m / 2, m * 0.46, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = qx + c * m;
    const y = qy + r * m;
    ctx.fillStyle = '#232c5c';
    roundRect(ctx, x, y, m * 7, m * 7, m * 2.2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + m, y + m, m * 5, m * 5, m * 1.6);
    ctx.fill();
    ctx.fillStyle = '#232c5c';
    roundRect(ctx, x + m * 2, y + m * 2, m * 3, m * 3, m * 1.1);
    ctx.fill();
  }
  try {
    const logo = await loadImage('/brand/badge-256.png');
    const ls = logoModules * m * 0.92;
    ctx.drawImage(logo, W / 2 - ls / 2, qy + size / 2 - ls / 2, ls, ls);
  } catch {
    /* no logo */
  }

  // Footer
  ctx.fillStyle = ink;
  ctx.font = '700 40px Nunito, sans-serif';
  ctx.fillText('Scan to add me on NivoTalk', W / 2, H - 92);
}

export function QrSheet({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const nav = useNavigate();
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(() => getPref('qrColor', '#232c5c'));
  const [busy, setBusy] = useState(false);
  const link = `${publicOrigin()}/u/${user.username}`;

  useEffect(() => {
    if (!open || !ref.current) return;
    drawQrCard(ref.current, user, color);
  }, [open, user, color]);

  const pick = (c: string) => {
    setColor(c);
    setPref('qrColor', c);
  };

  async function blob() {
    return canvasToBlob(ref.current!, 'image/png');
  }

  return (
    <Sheet open={open} onClose={onClose} title="My QR ID">
      <canvas ref={ref} className="mx-auto aspect-[3/4] w-full max-w-[300px] rounded-[22px] shadow-lg" aria-label={`QR code for @${user.username}`} />
      <p className="mt-4 mb-2 text-xs font-bold tracking-wide text-faint uppercase">Background</p>
      <div className="flex flex-wrap items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c.id}
            onClick={() => pick(c.c)}
            className={`h-8 w-8 rounded-full transition ${color === c.c ? 'scale-110 ring-[3px] ring-primary ring-offset-2 ring-offset-surface' : ''}`}
            style={{ background: c.c }}
            aria-label={c.id}
          />
        ))}
        <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-dashed border-line text-muted" title="Custom colour">
          <Icon name="palette" size={16} />
          <input type="color" value={color} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await shareImage(await blob(), `nivotalk-${user.username}.png`, 'Add me on NivoTalk').catch(() => {});
            setBusy(false);
          }}
        >
          <Icon name="share" size={19} /> Share
        </button>
        <button className="btn btn-soft" disabled={busy} onClick={async () => downloadImage(await blob(), `nivotalk-${user.username}.png`)}>
          <Icon name="download" size={19} /> Download
        </button>
      </div>
      <button className="btn btn-ghost btn-sm mx-auto mt-2 flex" onClick={async () => toast((await copyText(link)) ? 'Profile link copied' : link)}>
        <Icon name="link" size={17} /> Copy profile link
      </button>
      <button className="btn btn-soft mt-1 w-full" onClick={() => nav('/scan')}>
        <Icon name="camera" size={19} /> Scan a friend’s QR
      </button>
    </Sheet>
  );
}
