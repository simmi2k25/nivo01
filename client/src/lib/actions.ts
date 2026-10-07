import { useChat } from '../stores/chat';
import { api } from './api';
import type { Conversation, Friend, Room } from './types';

export async function openDirectChat(userId: number) {
  const { conversation } = await api<{ conversation: Conversation }>('/conversations/direct', { body: { userId } });
  useChat.getState().upsertConversation(conversation);
  return conversation;
}

/** Opens a booth room and drops an invite card into your chat with this person. */
export async function startBoothWith(userId: number) {
  const conv = await openDirectChat(userId);
  const { room } = await api<{ room: Room }>('/rooms', { body: { conversationId: conv.id } });
  return room;
}

export async function addFriend(by: { userId?: number; username?: string }) {
  const { friend } = await api<{ friend: Friend }>('/friends', { body: by });
  const st = useChat.getState();
  useChat.setState({
    friends: [friend, ...st.friends.filter((f) => f.id !== friend.id)],
    addedMe: st.addedMe.filter((u) => u.id !== friend.id),
  });
  return friend;
}

export async function removeFriend(id: number) {
  await api(`/friends/${id}`, { method: 'DELETE' });
  useChat.setState({ friends: useChat.getState().friends.filter((f) => f.id !== id) });
  useChat.getState().loadFriends().catch(() => {});
}

export async function setFavorite(id: number, favorite: boolean) {
  useChat.setState({ friends: useChat.getState().friends.map((f) => (f.id === id ? { ...f, favorite } : f)) });
  await api(`/friends/${id}`, { method: 'PATCH', body: { favorite } });
}

export async function blockUser(id: number) {
  await api('/blocks', { body: { userId: id } });
  const st = useChat.getState();
  useChat.setState({ friends: st.friends.filter((f) => f.id !== id), addedMe: st.addedMe.filter((u) => u.id !== id) });
}

export async function unblockUser(id: number) {
  await api(`/blocks/${id}`, { method: 'DELETE' });
}
