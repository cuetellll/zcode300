import type { Server } from 'socket.io';

/**
 * Central holder for the Socket.IO server instance. REST modules import the
 * emit helpers from here; the bus is populated once at boot (avoiding
 * circular imports between route modules and the realtime layer).
 */
export const socketBus: { io: Server | null } = { io: null };

function io(): Server | null {
  return socketBus.io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io()?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: Iterable<string>, event: string, payload: unknown): void {
  for (const userId of userIds) emitToUser(userId, event, payload);
}

export function emitToChannel(channelId: string, event: string, payload: unknown): void {
  io()?.to(`channel:${channelId}`).emit(event, payload);
}

export function emitToServer(serverId: string, event: string, payload: unknown): void {
  io()?.to(`server:${serverId}`).emit(event, payload);
}

export function emitToRadioRoom(channelId: string, event: string, payload: unknown): void {
  io()?.to(`radio:${channelId}`).emit(event, payload);
}

/** Hard-remove a user's sockets from every room of a server (kick/ban). */
export function forceLeaveServerRooms(userId: string, serverId: string, channelIds: string[]): void {
  const instance = socketBus.io;
  if (!instance) return;
  instance.in(`user:${userId}`).socketsLeave(`server:${serverId}`);
  for (const channelId of channelIds) {
    instance.in(`user:${userId}`).socketsLeave(`channel:${channelId}`);
    instance.in(`user:${userId}`).socketsLeave(`voice-room:${channelId}`);
    instance.in(`user:${userId}`).socketsLeave(`radio:${channelId}`);
  }
}
