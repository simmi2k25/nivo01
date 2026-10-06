import { useState } from 'react';
import { BUDDY_STICKER, PACKS, recentStickers, rememberSticker, stickerUrl } from '../lib/stickers';
import { Icon } from './Icon';

/** Sticker drawer: recent stickers plus one tab per character pack. */
export function StickerPicker({ onPick, height = 260 }: { onPick: (id: string) => void; height?: number }) {
  const [recent] = useState(recentStickers);
  const [tab, setTab] = useState<string>(recent.length ? 'recent' : PACKS[0].id);
  const list = tab === 'recent' ? recent : (PACKS.find((p) => p.id === tab)?.stickers.map((s) => s.id) ?? []);

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="scroll-thin flex shrink-0 gap-1 overflow-x-auto px-2 py-1.5">
        <button
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tab === 'recent' ? 'bg-primary-soft text-primary-strong' : 'text-muted'}`}
          onClick={() => setTab('recent')}
          aria-label="Recent stickers"
        >
          <Icon name="clock" size={20} />
        </button>
        {PACKS.map((p) => (
          <button
            key={p.id}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${tab === p.id ? 'bg-primary-soft' : 'opacity-70 hover:opacity-100'}`}
            onClick={() => setTab(p.id)}
            aria-label={`${p.name} stickers`}
          >
            <img src={stickerUrl(BUDDY_STICKER[p.id])} alt="" className="h-8 w-8 object-contain" />
          </button>
        ))}
      </div>
      <div className="scroll-thin grid min-h-0 flex-1 auto-rows-[76px] grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted">Stickers you send show up here</p>}
        {list.map((id) => (
          <button
            key={id}
            className="grid place-items-center rounded-xl p-1 transition hover:bg-primary-soft active:scale-90"
            onClick={() => {
              rememberSticker(id);
              onPick(id);
            }}
          >
            <img src={stickerUrl(id)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
