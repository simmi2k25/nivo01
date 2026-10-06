import { useState } from 'react';
import { convTitle } from '../lib/conv';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { GroupAvatar } from '../pages/Chats';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { toast } from './Toast';

/** Pick one of your chats and send a photo strip into it (with an optional caption). */
export function SendToChat({ open, onClose, photoId, defaultConversationId }: { open: boolean; onClose: () => void; photoId: number | null; defaultConversationId?: number | null }) {
  const me = useAuth((s) => s.user)!;
  const conversations = useChat((s) => s.conversations);
  const send = useChat((s) => s.send);
  const [caption, setCaption] = useState('');
  const [sent, setSent] = useState<number[]>([]);

  const sorted = defaultConversationId
    ? [...conversations].sort((a, b) => (a.id === defaultConversationId ? -1 : b.id === defaultConversationId ? 1 : 0))
    : conversations;

  return (
    <Sheet open={open} onClose={() => (setSent([]), onClose())} title="Send to a chat">
      <label className="field h-11">
        <Icon name="edit" size={18} className="text-faint" />
        <input placeholder="Add a caption (optional)" value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} />
      </label>
      <div className="mt-2 grid gap-0.5">
        {sorted.length === 0 && <p className="py-6 text-center text-sm text-muted">No chats yet — start one from Friends.</p>}
        {sorted.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
            <GroupAvatar c={c} meId={me.id} size={42} />
            <span className="min-w-0 flex-1 truncate font-bold">{convTitle(c, me.id)}</span>
            <button
              className={`btn btn-sm ${sent.includes(c.id) ? 'btn-soft' : 'btn-primary'}`}
              disabled={!photoId || sent.includes(c.id)}
              onClick={() => {
                if (!photoId) return;
                send(c.id, { kind: 'photo', body: caption.trim(), meta: { photoId } });
                setSent((s) => [...s, c.id]);
                toast('Sent 💌');
              }}
            >
              {sent.includes(c.id) ? 'Sent' : 'Send'}
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
