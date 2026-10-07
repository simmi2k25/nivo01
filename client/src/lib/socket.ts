import { Capacitor } from '@capacitor/core';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const readyListeners = new Set<(s: Socket) => void>();

export function getSocket() {
  return socket;
}

/** Runs fn with the socket now (if connected) and again after every reconnect. */
export function onSocket(fn: (s: Socket) => void) {
  readyListeners.add(fn);
  if (socket) fn(socket);
  return () => readyListeners.delete(fn);
}

export function connectSocket() {
  if (socket) return socket;
  socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  const s = socket;
  s.on('connect', reportAppState);
  // Late import avoids a cycle: the chat store also imports this module.
  import('../stores/chat').then(({ bindChatSocket }) => bindChatSocket(s));
  readyListeners.forEach((fn) => fn(s));
  return s;
}

// ---------- on screen or not (the server sends phone pushes only to people who aren't looking) ----------

let appActive = typeof document === 'undefined' || document.visibilityState === 'visible';
function reportAppState() {
  socket?.emit('app:state', { active: appActive });
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    appActive = document.visibilityState === 'visible';
    reportAppState();
  });
}
if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('App')) {
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => {
      appActive = isActive;
      reportAppState();
    }),
  );
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

let lastTyping = 0;
let typingConv = 0;
export function sendTyping(conversationId: number, typing: boolean) {
  if (!socket) return;
  const now = Date.now();
  if (typing && conversationId === typingConv && now - lastTyping < 2500) return;
  lastTyping = typing ? now : 0;
  typingConv = conversationId;
  socket.emit('typing', { conversationId, typing });
}
