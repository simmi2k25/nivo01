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
  /** Only on your own account. */
  email?: string;
  coins?: number;
  memorySlots?: number;
};

export type Friend = User & { favorite: boolean; mutual: boolean; addedAt: string };

export type ProfileUser = User & { isFriend: boolean; addedMe: boolean; friendCount: number; blockedByMe: boolean; isMe: boolean };

/** 'op' carries an edit, delete or reaction for an earlier message; it's applied, never shown. */
export type MessageKind = 'text' | 'sticker' | 'photo' | 'booth_invite' | 'system' | 'op';

export type Message = {
  id: number;
  conversationId: number;
  senderId: number | null;
  kind: MessageKind;
  body: string;
  meta: Record<string, any>;
  createdAt: string;
  editedAt?: string | null;
  /** Deleted for everyone — body and meta are empty and a placeholder is shown. */
  deletedAt?: string | null;
  replyToId?: number | null;
  replyTo?: ReplyPreview | null;
  /** userId → emoji */
  reactions?: Record<string, string>;
  clientId?: string;
  /** client-only delivery state for optimistic sends */
  pending?: boolean;
  failed?: boolean;
};

export type ReplyPreview = { id: number; senderId: number | null; kind: MessageKind; body: string; deleted: boolean };

export const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;

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
  /** Direct chats only: who blocked whom (you can read old messages but not send). */
  block?: 'byMe' | 'byThem' | null;
  /** A background picture everyone in the chat sees (set with coins). */
  wallpaperUrl?: string | null;
};

export type GroupInvite = { conversationId: number; title: string | null; memberCount: number; invitedBy: User | null; createdAt: string };

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

// ---------- Together: Chill Rooms ----------

export type ChillItem = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  videoId: string;
  durationMs: number | null;
  addedBy: number;
  by: Pick<User, 'id' | 'displayName' | 'avatar' | 'avatarUrl'> | null;
};

export type ChillState = {
  code: string;
  hostId: number;
  conversationId: number | null;
  queue: ChillItem[];
  index: number;
  playing: boolean;
  /** Where the song was at server time anchorAt. */
  positionMs: number;
  anchorAt: number;
  finished: boolean;
  listeners: User[];
};

export type ChillLine = {
  id: string;
  kind: 'text' | 'event';
  user: Pick<User, 'id' | 'displayName' | 'avatar' | 'avatarUrl'> | null;
  text: string;
  at: number;
};

export type NowPlaying = { title: string; artist: string; artwork: string | null; playing: boolean };

export type LiveChill = { code: string; hostId: number; host: User | null; conversationId: number | null; listeners: User[]; nowPlaying: NowPlaying | null };
export type LiveBooth = { code: string; hostId: number; host: User | null; conversationId: number | null; people: User[] };
