import type { Conversation, Message, User } from './types';

export const others = (c: Conversation, meId: number) => c.members.filter((m) => m.id !== meId);

export function convTitle(c: Conversation, meId: number) {
  if (c.title) return c.title;
  const o = others(c, meId);
  if (!o.length) return 'Just you';
  if (!c.isGroup) return o[0].displayName;
  const names = o.map((m) => m.displayName);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

export function preview(m: Message | null, meId: number, members: User[]) {
  if (!m) return 'Say hi 👋';
  const who = m.senderId === meId ? 'You: ' : '';
  const name = members.find((u) => u.id === m.senderId)?.displayName;
  if (m.deletedAt) return `${who}🚫 Message deleted`;
  switch (m.kind) {
    case 'sticker':
      return `${who}sent a sticker`;
    case 'photo':
      return `${who}📸 shared a photo strip`;
    case 'booth_invite':
      return `${m.senderId === meId ? 'You' : (name ?? 'Someone')} opened a photobooth`;
    case 'system':
      return m.body;
    default:
      return `${who}${m.body}`;
  }
}
