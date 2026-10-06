import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { SendToChat } from '../components/SendToChat';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, errorText } from '../lib/api';
import { downloadImage, shareImage } from '../lib/share';
import { stickerUrl } from '../lib/stickers';
import type { Photo } from '../lib/types';

export default function Memories() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);
  const [sendId, setSendId] = useState<number | null>(null);

  useEffect(() => {
    api<{ photos: Photo[] }>('/photos')
      .then((r) => setPhotos(r.photos))
      .catch((e) => {
        setPhotos([]);
        toast(errorText(e), 'error');
      });
  }, []);

  const blobOf = (p: Photo) => fetch(p.url, { credentials: 'include' }).then((r) => r.blob());

  async function remove(p: Photo) {
    if (!confirm('Delete this strip? It will also disappear from chats you shared it in.')) return;
    try {
      await api(`/photos/${p.id}`, { method: 'DELETE' });
      setPhotos((list) => list?.filter((x) => x.id !== p.id) ?? null);
      setOpen(null);
      toast('Deleted');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <header className="safe-top px-5 pt-4">
        <h1 className="text-[28px] font-bold">Memories</h1>
        <p className="text-sm text-muted">Your photo strips — only you can see this gallery.</p>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-28 md:pb-6">
        {photos === null && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="aspect-[1/2] animate-pulse rounded-2xl bg-primary-soft" />
            ))}
          </div>
        )}
        {photos?.length === 0 && (
          <div className="anim-rise py-12 text-center">
            <img src={stickerUrl('dino-15')} alt="" className="anim-float mx-auto h-32 w-32 object-contain" />
            <h2 className="mt-2 text-lg font-semibold">No strips yet</h2>
            <p className="text-sm text-muted">Hop into a booth with friends and save your first strip.</p>
            <Link to="/booth" className="btn btn-primary btn-sm mt-4">
              <Icon name="camera" size={18} /> Open the booth
            </Link>
          </div>
        )}
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {photos?.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setOpen(p)}
              className="anim-rise mb-3 block w-full break-inside-avoid overflow-hidden rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <img src={p.url} alt="Photo strip" loading="lazy" className="w-full rounded-xl" />
              <p className="px-1 pt-1 text-left text-[11px] font-semibold text-faint">{new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            </button>
          ))}
        </div>
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title="Strip">
        {open && (
          <div className="grid gap-3">
            <img src={open.url} alt="Photo strip" className="mx-auto max-h-[58dvh] rounded-2xl object-contain shadow" />
            <div className="grid grid-cols-3 gap-2">
              <button className="btn btn-soft btn-sm" onClick={async () => downloadImage(await blobOf(open), `nivotalk-strip-${open.id}.jpg`)}>
                <Icon name="download" size={17} /> Save
              </button>
              <button className="btn btn-soft btn-sm" onClick={async () => shareImage(await blobOf(open), `nivotalk-strip-${open.id}.jpg`).catch(() => {})}>
                <Icon name="share" size={17} /> Share
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setSendId(open.id)}>
                <Icon name="send" size={17} /> Chat
              </button>
            </div>
            <button className="btn btn-ghost btn-sm !text-danger" onClick={() => remove(open)}>
              <Icon name="trash" size={17} /> Delete
            </button>
          </div>
        )}
      </Sheet>
      <SendToChat open={sendId !== null} onClose={() => setSendId(null)} photoId={sendId} />
    </div>
  );
}
