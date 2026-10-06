export type ScanResult = { type: 'user'; username: string } | { type: 'booth'; code: string };

/** Understands NivoTalk QR links: https://<site>/u/<username> and https://<site>/booth/<CODE>. */
export function parseNivoCode(text: string): ScanResult | null {
  let path = text.trim();
  try {
    path = new URL(path).pathname;
  } catch {
    /* not a URL — maybe a bare path */
  }
  const user = path.match(/^\/u\/([a-z0-9._]{3,20})\/?$/i);
  if (user) return { type: 'user', username: user[1].toLowerCase() };
  const booth = path.match(/^\/booth\/([A-HJ-NP-Z2-9]{6})\/?$/i);
  if (booth) return { type: 'booth', code: booth[1].toUpperCase() };
  return null;
}

type Source = HTMLVideoElement | ImageBitmap;
type Decoder = (src: Source) => Promise<string | null>;

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
      getSupportedFormats(): Promise<string[]>;
    };
  }
}

const dims = (src: Source) =>
  src instanceof HTMLVideoElement ? { w: src.videoWidth, h: src.videoHeight } : { w: src.width, h: src.height };

/** Uses the phone's built-in barcode detector when available, otherwise jsQR (loaded on demand). */
export async function createDecoder(): Promise<Decoder> {
  const BD = window.BarcodeDetector;
  if (BD) {
    try {
      if ((await BD.getSupportedFormats()).includes('qr_code')) {
        const detector = new BD({ formats: ['qr_code'] });
        return async (src) => (await detector.detect(src))[0]?.rawValue ?? null;
      }
    } catch {
      /* fall through to jsQR */
    }
  }
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const attempt = (src: Source, w: number, h: number, longest: number) => {
    const scale = Math.min(1, longest / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
  // NivoTalk QR codes are drawn as round dots; up close jsQR sees the gaps between them, so if a
  // large image fails, retry smaller — downscaling blends the dots back into solid modules.
  return async (src) => {
    const { w, h } = dims(src);
    if (!w || !h) return null;
    for (const longest of [800, 480, 320]) {
      const found = attempt(src, w, h, longest);
      if (found) return found;
    }
    return null;
  };
}
