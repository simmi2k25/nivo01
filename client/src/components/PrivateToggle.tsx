import { Icon } from './Icon';

/** "Private room" switch for Chill Rooms and booths: friends don't see the room live; links and invites still work. */
export function PrivateToggle({ on, onChange, dark = false, disabled = false }: { on: boolean; onChange: (v: boolean) => void; dark?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex w-full items-center gap-3 rounded-[22px] p-3.5 text-left transition disabled:opacity-60 ${
        dark ? 'bg-white/10 text-white' : 'border border-line'
      }`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${dark ? 'bg-white/15' : 'bg-primary-soft text-primary'}`}>
        <Icon name="lock" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">Private room</span>
        <span className={`block text-xs leading-snug ${dark ? 'text-white/70' : 'text-muted'}`}>
          {on ? 'Hidden from friends — only people with the link or an invite can join' : 'Friends can see it live and drop in'}
        </span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-primary' : dark ? 'bg-white/25' : 'bg-black/15'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-300 ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
