export type Buddy = 'berri' | 'chatty' | 'dino' | 'pepo' | 'pomi';

export type Song = {
  trackId: number;
  title: string;
  artist: string;
  artwork: string | null;
  previewUrl: string;
  url: string | null;
};

export type User = {
  id: number;
  username: string;
  displayName: string;
  bio: string;
  avatar: Buddy;
  themeColor: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  song: Song | null;
  lastSeenAt: string | null;
  online: boolean;
  email?: string;
};

export type Friend = User & { favorite: boolean; mutual: boolean; addedAt: string };

export type ProfileUser = User & { isFriend: boolean; addedMe: boolean; friendCount: number; isMe: boolean };

export type MessageKind = 'text' | 'sticker' | 'photo' | 'booth_invite' | 'system';

export type Message = {
  id: number;
  conversationId: number;
  senderId: number | null;
  kind: MessageKind;
  body: string;
  meta: Record<string, any>;
  createdAt: string;
  clientId?: string;
  /** client-only delivery state for optimistic sends */
  pending?: boolean;
  failed?: boolean;
};

export type Conversation = {
  id: number;
  isGroup: boolean;
  title: string | null;
  createdBy: number | null;
  updatedAt: string;
  muted: boolean;
  lastReadAt: string;
  unread: number;
  lastMessage: Message | null;
  members: User[];
  readStates: Record<string, string>;
};

export type Room = {
  code: string;
  hostId: number;
  host: User | null;
  conversationId: number | null;
  shots: number;
  countdown: number;
  status: 'open' | 'closed';
  createdAt: string;
  expiresAt: string;
  participants: { userId: number; user: User }[];
};

export type Photo = { id: number; url: string; roomCode: string | null; size: number; createdAt: string };
