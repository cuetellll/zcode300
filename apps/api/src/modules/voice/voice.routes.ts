import { Router } from 'express';
import { z } from 'zod';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden, HttpError, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { canAccessChannel, getServerForUser, requireServerPermission } from '../../middleware/permissions';
import { serializeUser, serializeVoiceSession } from '../../lib/serialize';

export const voiceRouter = Router();

export const LIVEKIT_TOKEN_TTL_SECONDS = 60 * 30;

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Validate and normalize LiveKit config. Throws typed, secret-free errors. */
export function livekitConfig(): LiveKitConfig {
  const url = (env.LIVEKIT_URL ?? '').trim();
  const apiKey = (env.LIVEKIT_API_KEY ?? '').trim();
  const apiSecret = (env.LIVEKIT_API_SECRET ?? '').trim();
  if (!url || !apiKey || !apiSecret) {
    throw new HttpError(503, 'Voice is not configured on this deployment', 'LIVEKIT_CONFIG_MISSING', {
      missing: [
        ...(url ? [] : ['LIVEKIT_URL']),
        ...(apiKey ? [] : ['LIVEKIT_API_KEY']),
        ...(apiSecret ? [] : ['LIVEKIT_API_SECRET']),
      ],
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(503, 'LIVEKIT_URL is not a valid URL', 'LIVEKIT_URL_INVALID');
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(503, 'LIVEKIT_URL must use ws/wss (or http/https)', 'LIVEKIT_URL_INVALID');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new HttpError(503, 'LIVEKIT_URL must be a bare host origin', 'LIVEKIT_URL_INVALID');
  }
  if (env.isProduction && parsed.protocol === 'ws:') {
    throw new HttpError(503, 'LIVEKIT_URL must use wss in production', 'LIVEKIT_URL_INSECURE');
  }
  const clientUrl = parsed.protocol === 'https:' ? `wss://${parsed.host}` : `ws://${parsed.host}`;
  return { url: clientUrl, apiKey, apiSecret };
}

export function serverRoomService(): RoomServiceClient {
  const config = livekitConfig();
  const httpUrl = config.url.replace(/^ws(s?):\/\//, (_m, s: string) => (s ? 'https://' : 'http://'));
  return new RoomServiceClient(httpUrl, config.apiKey, config.apiSecret);
}

/**
 * Force-remove a user from every voice room of a server (kick/ban/role
 * revocation). LiveKit is the source of truth for connected participants.
 */
export async function revokeUserFromServerVoice(serverId: string, userId: string): Promise<void> {
  const channels = await prisma.channel.findMany({ where: { serverId, type: 'VOICE' }, select: { id: true } });
  await prisma.voiceSession.deleteMany({
    where: { userId, channel: { serverId } },
  });
  try {
    const roomService = serverRoomService();
    for (const channel of channels) {
      await roomService.removeParticipant(channel.id, userId).catch(() => undefined);
    }
  } catch {
    // LiveKit admin API unavailable — DB cleanup above still applies.
  }
}

const tokenSchema = z.object({ channel_id: z.string().min(1).max(64) });
const dmTokenSchema = z.object({ conversation_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

voiceRouter.post(
  '/token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = tokenSchema.parse(req.body);
    const channel = await prisma.channel.findUnique({ where: { id: body.channel_id } });
    if (!channel || channel.type !== 'VOICE') throw notFound('Voice channel not found');
    if (!(await canAccessChannel(userId, channel))) throw forbidden('No access to this channel');
    const member = await requireServerPermission(userId, channel.serverId, 'CONNECT_VOICE');
    const canSpeak = member.isOwner || member.nodes.has('ADMINISTRATOR') || member.nodes.has('SPEAK_VOICE');
    const canStream = member.isOwner || member.nodes.has('ADMINISTRATOR') || member.nodes.has('STREAM_VIDEO');

    const config = livekitConfig();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity: userId,
      name: user?.displayName ?? userId,
      ttl: LIVEKIT_TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ type: 'member', channel_id: channel.id }),
    });
    token.addGrant({
      roomJoin: true,
      room: channel.id,
      canSubscribe: true,
      canPublishData: true,
      canPublish: canSpeak || canStream,
      canPublishSources: [
        ...(canSpeak ? (['microphone'] as const) : []),
        ...(canStream ? (['camera', 'screen_share', 'screen_share_audio'] as const) : []),
      ],
    });
    const jwt = await token.toJwt();
    res.json({
      url: config.url,
      token: jwt,
      room: channel.id,
      identity: userId,
      permissions: { can_speak: canSpeak, can_stream: canStream },
    });
  }),
);

/** DM / group call token. Room name is derived from the conversation id. */
voiceRouter.post(
  '/dm/call-token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = dmTokenSchema.parse(req.body);
    const conversationId = body.conversation_id;

    const latest = await prisma.directMessage.findFirst({
      where: { conversationId, participantIds: { has: userId } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw notFound('Conversation not found');

    if (!latest.isGroup) {
      const others = latest.participantIds.filter((id) => id !== userId);
      const blocked = await prisma.friend.findFirst({
        where: { status: 'BLOCKED', OR: [{ userId, friendId: { in: others } }, { userId: { in: others }, friendId: userId }] },
      });
      if (blocked) throw forbidden('You cannot call this conversation');
    }

    const config = livekitConfig();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const room = `dm_${conversationId}`.slice(0, 120);
    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity: userId,
      name: user?.displayName ?? userId,
      ttl: LIVEKIT_TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ type: 'member', conversation_id: conversationId }),
    });
    token.addGrant({
      roomJoin: true,
      room,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
    });
    const jwt = await token.toJwt();

    const participants = await prisma.user.findMany({
      where: { id: { in: latest.participantIds } },
    });
    res.json({
      url: config.url,
      token: jwt,
      room,
      identity: userId,
      conversation_id: conversationId,
      participant_ids: latest.participantIds,
      participants: participants.map(serializeUser),
    });
  }),
);

/** Persisted voice presence for the member sidebar (servers the user belongs to). */
voiceRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const serverId = String(req.query.server_id ?? '');
    if (serverId) {
      await getServerForUser(userId, serverId);
    } else {
      const memberships = await prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } });
      if (memberships.length === 0) {
        res.json({ sessions: [] });
        return;
      }
      const sessions = await prisma.voiceSession.findMany({
        where: { channel: { serverId: { in: memberships.map((m) => m.serverId) } } },
        include: { user: true, channel: { select: { serverId: true } } },
        orderBy: { joinedAt: 'asc' },
      });
      res.json({ sessions: sessions.map(serializeVoiceSession) });
      return;
    }
    const sessions = await prisma.voiceSession.findMany({
      where: { channel: { serverId } },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    res.json({ sessions: sessions.map(serializeVoiceSession) });
  }),
);
