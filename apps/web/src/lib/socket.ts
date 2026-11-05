import { io, type Socket } from 'socket.io-client';
import { getAccessToken, useAuthStore } from '../stores/auth';
import { handleRealtimeEvent } from '../stores/data';

let socket: Socket | null = null;
let connected = false;

const connectionListeners = new Set<(connected: boolean) => void>();
const connectListeners = new Set<() => void>();

export function onConnectionChange(listener: (connected: boolean) => void): void {
  connectionListeners.add(listener);
  listener(connected);
}

/** Callbacks run after every (re)connect — used to re-join authorized rooms. */
export function onConnect(listener: () => void): void {
  connectListeners.add(listener);
}

export function connectSocket(): void {
  const token = getAccessToken();
  if (!token || socket) return;
  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect', () => {
    connected = true;
    connectionListeners.forEach((listener) => listener(true));
    connectListeners.forEach((listener) => listener());
  });

  socket.on('disconnect', () => {
    connected = false;
    connectionListeners.forEach((listener) => listener(false));
  });

  socket.on('connect_error', (error) => {
    if (/authentication|expired|invalid/i.test(error.message)) {
      useAuthStore.getState().clear();
    }
  });

  for (const event of REALTIME_EVENTS) {
    socket.on(event, (payload: unknown) => handleRealtimeEvent(event, payload));
  }
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  connected = false;
  connectionListeners.forEach((listener) => listener(false));
}

export function emitSocket(event: string, payload?: unknown, ack?: (result: unknown) => void): void {
  if (!socket?.connected) return;
  if (ack) socket.emit(event, payload, ack);
  else socket.emit(event, payload);
}

export function isSocketConnected(): boolean {
  return connected;
}

const REALTIME_EVENTS = [
  'presence:update',
  'message:new',
  'message:updated',
  'message:deleted',
  'direct_message:new',
  'direct_message:updated',
  'direct_message:deleted',
  'direct_message:conversation_new',
  'direct_message:conversation_updated',
  'typing:update',
  'dm:typing',
  'voice:updated',
  'radio:state',
  'notification:new',
  'friends:updated',
  'server:updated',
  'server:deleted',
  'server:member_added',
  'server:member_removed',
  'server:permissions_changed',
  'server:membership_revoked',
  'dm:call_started',
  'dm:call_ended',
] as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];
