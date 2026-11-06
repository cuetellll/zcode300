import { io, type Socket } from 'socket.io-client';
import { getAccessToken, useAuthStore } from '../stores/auth';
import { refreshAccessToken } from './api';

let socket: Socket | null = null;
let connected = false;

const connectionListeners = new Set<(connected: boolean) => void>();
const connectListeners = new Set<() => void>();

/**
 * Realtime event dispatcher. The stores/data module registers itself here at
 * boot via setRealtimeHandler() — socket.ts must NOT import stores/data
 * (circular import crashed the whole bundle at eval time).
 */
let realtimeHandler: ((event: string, payload: unknown) => void) | null = null;

export function setRealtimeHandler(handler: (event: string, payload: unknown) => void): void {
  realtimeHandler = handler;
}

export function onConnectionChange(listener: (connected: boolean) => void): void {
  connectionListeners.add(listener);
  listener(connected);
}

/** Callbacks run after every (re)connect — used to re-join authorized rooms. */
export function onConnect(listener: () => void): void {
  connectListeners.add(listener);
}

export function connectSocket(): void {
  if (socket) return;
  // auth is a callback so every (re)connect attempt signs in with the
  // CURRENT in-memory access token (15-min TTL — a static token would be
  // rejected after expiry and log the user out via connect_error).
  socket = io('/', {
    auth: (callback) => callback({ token: getAccessToken() ?? '' }),
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

  socket.on('connect_error', async (error) => {
    if (!/authentication|expired|invalid/i.test(error.message)) return;
    // The handshake token expired. Rotate it silently; only log out when the
    // refresh session itself is gone.
    const token = await refreshAccessToken().catch(() => null);
    if (token) {
      socket?.disconnect().connect();
    } else {
      disconnectSocket();
      useAuthStore.getState().clear();
    }
  });

  for (const event of REALTIME_EVENTS) {
    socket.on(event, (payload: unknown) => realtimeHandler?.(event, payload));
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

// TEMP DEBUG: observable socket state
if (typeof window !== 'undefined') {
  (window as unknown as { __mgSocket: { connected: () => boolean } }).__mgSocket = { connected: () => connected };
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
