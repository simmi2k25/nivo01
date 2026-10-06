import { create } from 'zustand';

type Toast = { id: number; text: string; tone: 'info' | 'error' };
const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));

let n = 0;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = ++n;
  useToasts.setState((s) => ({ list: [...s.list.slice(-2), { id, text, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), 3200);
}

export function Toaster() {
  const list = useToasts((s) => s.list);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-3 safe-top" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={`anim-pop rounded-full px-5 py-2.5 text-sm font-bold shadow-lg ${
            t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-surface'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
