const AMBER = 'bg-gradient-to-b from-[#f6b33d] to-[#e58a00]';

/** The game's mark: an amber "?" tile. */
export function QuestionTile({ size = 56 }: { size?: number }) {
  return (
    <span
      className={`${AMBER} grid shrink-0 place-items-center rounded-[30%] font-display font-bold text-white shadow-[inset_0_-4px_0_rgba(0,0,0,0.12),0_8px_18px_rgba(229,138,0,0.3)]`}
      style={{ width: size, height: size, fontSize: size * 0.56 }}
      aria-hidden="true"
    >
      ?
    </span>
  );
}
