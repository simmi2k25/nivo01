import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button className="anim-fade absolute inset-0 bg-[#1b2148]/40 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div
        className={`anim-sheet relative flex max-h-[88dvh] w-full flex-col rounded-t-[28px] bg-surface shadow-2xl sm:rounded-[28px] ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 pt-3 pb-1 sm:pt-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
              <Icon name="x" size={20} />
            </button>
          </div>
        )}
        <div className="scroll-thin safe-bottom min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
