import type { ReactNode } from 'react';
import { statusLook, type StatusStyle } from '../lib/statusStyles';

/** A tile in the story/bubble rows on Friends and Chats. With a status, the tile takes on that status's background. */
export function StoryCard({ label, onClick, look, children }: { label: string; onClick: () => void; look?: StatusStyle; children: ReactNode }) {
  const styled = look ? statusLook(look) : null;
  return (
    <button
      onClick={onClick}
      className="anim-rise flex w-[84px] shrink-0 flex-col items-center gap-2 rounded-[22px] bg-surface px-1.5 pt-3.5 pb-3 shadow-[var(--shadow-sm)] transition active:scale-95"
      style={styled ? { background: styled.background, color: styled.color } : undefined}
    >
      {children}
      <span className="w-full truncate text-center text-[12px] font-bold">{label}</span>
    </button>
  );
}
