import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { createDecoder, parseNivoCode, type ScanResult } from '../lib/qrscan';

/** Full-screen QR scanner: point at a friend's NivoTalk QR (or pick a photo of one) to open their profile. */
export default function ScanPage() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [camError, setCamError] = useState('');
  const [starting, setStarting] = useState(true);

  function open(r: ScanResult) {
    if (done.current) return;
    done.current = true;
    navigator.vibrate?.(40);
    nav(r.type === 'user' ? `/u/${r.username}` : `/booth/${r.code}`, { replace: true });
  }

  function handle(text: string | null, fromPhoto = false) {
    if (!text) {
      if (fromPhoto) toast('No QR code found in that picture', 'error');
      return false;
    }
    const r = parseNivoCode(text);
    if (r) {
      open(r);
      return true;
    }
    toast('That QR isn’t a NivoTalk code', 'error');
    return false;
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let lastBad = '';

    (async () => {
      const decode = await createDecoder();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        setStarting(false);
        setCamError(
          (e as DOMException).name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow it in settings, or scan a photo of the QR instead.'
            : 'No camera available. You can scan a photo of the QR instead.',
        );
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setStarting(false);

      const tick = async () => {
        if (stopped || done.current) return;
        if (v.readyState >= 2) {
          const text = await decode(v).catch(() => null);
          // Ignore the same non-NivoTalk code repeatedly so the toast doesn't spam.
          if (text && text !== lastBad && !handle(text)) lastBad = text;
        }
        timer = setTimeout(tick, 180);
      };
      tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function scanPhoto(file?: File) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const decode = await createDecoder();
      handle(await decode(bitmap), true);
      bitmap.close();
    } catch {
      toast('That picture couldn’t be opened', 'error');
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#0f1330] text-white">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {/* dimmed surround with a clear square in the middle */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative aspect-square w-[min(72vw,320px)] rounded-[28px] shadow-[0_0_0_200vmax_rgba(15,19,48,0.55)]">
          {['top-0 left-0 border-t-4 border-l-4 rounded-tl-[28px]', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-[28px]', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-[28px]'].map((c) => (
            <span key={c} className={`absolute h-12 w-12 border-white ${c}`} />
          ))}
          {!camError && <span className="scan-line absolute inset-x-5 h-[3px] rounded-full bg-[var(--primary)] shadow-[0_0_14px_var(--primary)]" />}
        </div>
      </div>

      <header className="safe-top relative z-10 flex items-center gap-2 px-3 py-2">
        <button className="icon-btn !text-white hover:!bg-white/15" onClick={() => nav(-1)} aria-label="Close scanner">
          <Icon name="x" />
        </button>
        <h1 className="flex-1 text-center text-lg font-semibold">Scan QR code</h1>
        <span className="w-10" />
      </header>

      <div className="flex-1" />

      <div className="safe-bottom relative z-10 grid justify-items-center gap-3 px-6 pb-8 text-center">
        <p className="max-w-xs text-sm font-semibold opacity-90">
          {camError || (starting ? 'Starting camera…' : 'Point at a friend’s NivoTalk QR to open their profile')}
        </p>
        <div className="flex gap-2">
          <button className="btn btn-sm bg-white/15 text-white" onClick={() => fileInput.current?.click()}>
            <Icon name="image" size={17} /> Scan from photo
          </button>
          <button className="btn btn-sm bg-white/15 text-white" onClick={() => nav('/profile?qr=1', { replace: true })}>
            <Icon name="qr" size={17} /> My QR
          </button>
        </div>
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => (scanPhoto(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}
