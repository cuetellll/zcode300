import type { Server as SocketServer, Socket } from 'socket.io';
import type { Channel } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { verifyAccessToken } from '../modules/auth/auth.service';
import { canAccessChannel, getMemberContext, memberHasPermission } from '../middleware/permissions';
import { serializeVoiceSession } from '../lib/serialize';
import { logger } from '../lib/logger';
import { emitToChannel, emitToServer as emitServer } from './socket-bus';
import { radioManager } from '../modules/radio/radio.context';

/**
 * Socket.IO gateway. Every event is authenticated and authorized against the
 * database — socket room membership alone never grants access.
 */

const presence = new Map<string, Set<string>>(); // userId -> socket ids

const VOICE_STATE_FIELDS = ['muted', 'deafened', 'videoEnabled', 'screenSharing'] as const;

function broadcastPresence(): void {
  const userIds = [...presence.keys()];
  socketIo()?.emit('presence:update', { user_ids: userIds });
}

function socketIo(): SocketServer | null {
  return globalSocket ?? null;
}

// Populated in attachRealtime() below (module-local to avoid another export).
let globalSocket: SocketServer | null = null;

export function attachRealtime(io: SocketServer): void {
  globalSocket = io;

  // -- handshake auth --------------------------------------------------------
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length < 8) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const userId = verifyAccessToken(token);
      socket.data.userId = userId;
      next();
    } catch {
      next(new Error('Invalid or expired access token'));
    }
  });

  // per-socket event rate limit
  io.use((socket, next) => {
    let count = 0;
    const window = setInterval(() => {
      count = 0;
    }, 10_000);
    window.unref();
    socket.once('disconnect', () => clearInterval(window));
    socket.use((_event, nextEvent) => {
      count += 1;
      if (count > 60) {
        nextEvent(new Error('Socket event rate limit exceeded'));
        return;
      }
      nextEvent();
    });
    next();
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    logger.info('socket connected', { userId, socketId: socket.id });
    socket.join(`user:${userId}`);
    const sockets = presence.get(userId) ?? new Set<string>();
    const wasOnline = sockets.size > 0;
    sockets.add(socket.id);
    presence.set(userId, sockets);
    if (!wasOnline) broadcastPresence();

    socket.on('disconnect', async (reason: string) => {
      logger.info('socket disconnected', { userId, reason });
      const remaining = presence.get(userId);
      if (remaining) {
        remaining.delete(socket.id);
        if (remaining.size === 0) {
          presence.delete(userId);
          broadcastPresence();
          // Reap this user's voice presence rows (ghost cleanup).
          const sessions = await prisma.voiceSession.findMany({ where: { userId }, include: { channel: true } });
          if (sessions.length > 0) {
            await prisma.voiceSession.deleteMany({ where: { userId } });
            for (const session of sessions) {
              emitToChannel(session.channelId, 'voice:updated', {
                channel_id: session.channelId,
                user_id: userId,
                removed: true,
              });
              emitServer(session.channel.serverId, 'voice:updated', {
                channel_id: session.channelId,
                user_id: userId,
                removed: true,
              });
            }
          }
        }
      }
    });

    // -- rooms ----------------------------------------------------------------
    socket.on('server:join', async (serverId: string, ack?: (result: unknown) => void) => {
      try {
        const ctx = await getMemberContext(userId, String(serverId));
        socket.join(`server:${serverId}`);
        void ctx;
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'Forbidden' });
      }
    });

    socket.on('server:leave', (serverId: string) => {
      socket.leave(`server:${serverId}`);
    });

    socket.on('channel:join', async (channelId: string, ack?: (result: unknown) => void) => {
      try {
        const channel = await prisma.channel.findUnique({ where: { id: String(channelId) } });
        if (!channel || !(await canAccessChannel(userId, channel))) {
          ack?.({ ok: false, error: 'Forbidden' });
          return;
        }
        socket.join(`channel:${channelId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'Forbidden' });
      }
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // -- typing ---------------------------------------------------------------
    socket.on('typing:start', async (payload: { channelId?: string }, ack?: (result: unknown) => void) => {
      const channel = await prisma.channel.findUnique({ where: { id: String(payload?.channelId ?? '') } });
      if (!channel || !(await canAccessChannel(userId, channel))) {
        ack?.({ ok: false });
        return;
      }
      socket.to(`channel:${channel.id}`).emit('typing:update', { channel_id: channel.id, user_id: userId });
      ack?.({ ok: true });
    });

    socket.on('dm:typing', async (payload: { conversationId?: string }, ack?: (result: unknown) => void) => {
      const conversationId = String(payload?.conversationId ?? '');
      const conversation = await prisma.directMessage.findFirst({
        where: { conversationId, participantIds: { has: userId } },
        orderBy: { createdAt: 'desc' },
        select: { participantIds: true },
      });
      if (!conversation) {
        ack?.({ ok: false });
        return;
      }
      for (const participantId of conversation.participantIds) {
        if (participantId !== userId) {
          io.to(`user:${participantId}`).emit('dm:typing', { conversation_id: conversationId, user_id: userId });
        }
      }
      ack?.({ ok: true });
    });

    socket.on('dm:call_ended', async (payload: { conversationId?: string }, ack?: (result: unknown) => void) => {
      const conversationId = String(payload?.conversationId ?? '');
      const conversation = await prisma.directMessage.findFirst({
        where: { conversationId, participantIds: { has: userId } },
        orderBy: { createdAt: 'desc' },
        select: { participantIds: true },
      });
      if (conversation) {
        for (const participantId of conversation.participantIds) {
          if (participantId !== userId) {
            io.to(`user:${participantId}`).emit('dm:call_ended', { conversation_id: conversationId });
          }
        }
      }
      ack?.({ ok: true });
    });

    // -- voice presence -------------------------------------------------------
    socket.on('voice:join', async (payload: { channelId?: string }, ack?: (result: unknown) => void) => {
      try {
        const channel = await prisma.channel.findUnique({ where: { id: String(payload?.channelId ?? '') } });
        if (!channel || channel.type !== 'VOICE' || !(await canAccessChannel(userId, channel))) {
          ack?.({ ok: false, error: 'Forbidden' });
          return;
        }
        const ctx = await getMemberContext(userId, channel.serverId);
        if (!memberHasPermission(ctx, 'CONNECT_VOICE')) {
          ack?.({ ok: false, error: 'Missing CONNECT_VOICE' });
          return;
        }
        const session = await prisma.voiceSession.upsert({
          where: { channelId_userId: { channelId: channel.id, userId } },
          update: {},
          create: { channelId: channel.id, userId },
          include: { user: true },
        });
        socket.join(`voice-room:${channel.id}`);
        socket.join(`radio:${channel.id}`);
        const payloadOut = serializeVoiceSession(session);
        emitToChannel(channel.id, 'voice:updated', { channel_id: channel.id, session: payloadOut });
        emitServer(channel.serverId, 'voice:updated', { channel_id: channel.id, session: payloadOut });
        // Hand the radio snapshot to the newly joined listener.
        const radioState = radioManager.getPublicState(channel.id);
        if (radioState) socket.emit('radio:state', radioState);
        ack?.({ ok: true });
      } catch (error) {
        logger.warn('voice:join failed', { userId, error: String(error) });
        ack?.({ ok: false, error: 'Join failed' });
      }
    });

    socket.on('voice:leave', async (payload: { channelId?: string }, ack?: (result: unknown) => void) => {
      const channelId = String(payload?.channelId ?? '');
      const channel = await prisma.channel.findUnique({ where: { id: channelId } });
      socket.leave(`voice-room:${channelId}`);
      socket.leave(`radio:${channelId}`);
      const deleted = await prisma.voiceSession
        .deleteMany({ where: { channelId, userId } })
        .catch(() => ({ count: 0 }));
      if (channel && deleted.count > 0) {
        emitToChannel(channelId, 'voice:updated', { channel_id: channelId, user_id: userId, removed: true });
        emitServer(channel.serverId, 'voice:updated', { channel_id: channelId, user_id: userId, removed: true });
      }
      ack?.({ ok: true });
    });

    socket.on('voice:state', async (payload: Record<string, unknown>, ack?: (result: unknown) => void) => {
      const channelId = String(payload?.channelId ?? '');
      const session = await prisma.voiceSession.findUnique({
        where: { channelId_userId: { channelId, userId } },
        include: { channel: true, user: true },
      });
      if (!session) {
        ack?.({ ok: false, error: 'Not in this voice room' });
        return;
      }
      const updates: Partial<Record<(typeof VOICE_STATE_FIELDS)[number], boolean>> = {};
      for (const field of VOICE_STATE_FIELDS) {
        if (typeof payload[field] === 'boolean') updates[field] = payload[field] as boolean;
      }
      const updated = await prisma.voiceSession.update({
        where: { id: session.id },
        data: updates,
        include: { user: true },
      });
      const payloadOut = serializeVoiceSession(updated);
      emitToChannel(channelId, 'voice:updated', { channel_id: channelId, session: payloadOut });
      emitServer(session.channel.serverId, 'voice:updated', { channel_id: channelId, session: payloadOut });
      ack?.({ ok: true });
    });

    // -- radio control --------------------------------------------------------
    socket.on('radio:play', async (payload: { channelId?: string; stationId?: string }, ack?: (result: unknown) => void) => {
      try {
        const channelId = String(payload?.channelId ?? '');
        const stationId = String(payload?.stationId ?? '');
        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel || channel.type !== 'VOICE' || !(await canAccessChannel(userId, channel))) {
          ack?.({ ok: false, error: 'Join the voice channel first', code: 'NOT_IN_VOICE' });
          return;
        }
        const voiceSession = await prisma.voiceSession.findUnique({
          where: { channelId_userId: { channelId, userId } },
        });
        if (!voiceSession) {
          ack?.({ ok: false, error: 'Join the voice channel first', code: 'NOT_IN_VOICE' });
          return;
        }
        const state = await radioManager.playOrSwitch(channelId, channel.serverId, stationId);
        ack?.({ ok: true, state });
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = (error as { message?: string }).message ?? 'Radio command failed';
        const code = (error as { code?: string }).code ?? (status === 429 ? 'RADIO_CAPACITY_FULL' : 'RADIO_ERROR');
        ack?.({ ok: false, error: message, code });
      }
    });

    socket.on('radio:stop', async (payload: { channelId?: string }, ack?: (result: unknown) => void) => {
      const channelId = String(payload?.channelId ?? '');
      const voiceSession = await prisma.voiceSession.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });
      if (!voiceSession) {
        ack?.({ ok: false, error: 'Join the voice channel first', code: 'NOT_IN_VOICE' });
        return;
      }
      radioManager.stopRoom(channelId, 'manual');
      ack?.({ ok: true });
    });

    // Re-join currently subscribed channels after reconnect (client-driven).
    socket.on('restore:rooms', async (payload: { serverIds?: string[]; channelId?: string }, ack?: (result: unknown) => void) => {
      const serverIds = Array.isArray(payload?.serverIds) ? payload.serverIds.slice(0, 20) : [];
      for (const serverId of serverIds) {
        try {
          await getMemberContext(userId, String(serverId));
          socket.join(`server:${serverId}`);
        } catch {
          // not a member anymore — skip
        }
      }
      const channelId = payload?.channelId ? String(payload.channelId) : null;
      if (channelId) {
        const channel: Channel | null = await prisma.channel.findUnique({ where: { id: channelId } });
        if (channel && (await canAccessChannel(userId, channel))) socket.join(`channel:${channelId}`);
      }
      ack?.({ ok: true });
    });
  });

  if (!env.isProduction) {
    logger.info('realtime layer attached (development)');
  }
}

export function onlineUserIds(): string[] {
  return [...presence.keys()];
}
