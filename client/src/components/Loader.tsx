/** Branded loader: the NivoTalk badge inside a spinning ring with bouncing dots. */
export function Loader({ waking = false, compact = false }: { waking?: boolean; compact?: boolean }) {
  const s = compact ? 56 : 92;
  return (
    <div className="grid h-full w-full place-items-center p-6" role="status">
      <div className="grid justify-items-center gap-3.5">
        <div className="relative grid place-items-center" style={{ width: s, height: s }}>
          <span className="anim-spin absolute inset-0 rounded-full border-[3px] border-primary-soft border-t-primary" />
          <img src="/brand/badge-256.png" alt="" className="rounded-full shadow-lg" style={{ width: s * 0.76, height: s * 0.76 }} />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className="block h-[7px] w-[7px] rounded-full bg-primary"
              style={{ animation: `typing-dot 1s ${i * 0.15}s ease-in-out infinite` }}
            />
          ))}
        </div>
        {waking && (
          <div className="anim-fade text-center">
            <b className="block text-[15px]">Waking up NivoTalk…</b>
            <span className="text-[12.5px] text-muted">This takes a few seconds after a quiet spell</span>
          </div>
        )}
      </div>
    </div>
  );
}
