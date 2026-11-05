import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { requireServerPermission } from '../../middleware/permissions';
import { serializeChannel } from '../../lib/serialize';
import { emitToServer } from '../../realtime/socket-bus';
import { radioManager } from '../radio/radio.context';
import { writeAudit } from '../servers/servers.service';

export const channelsRouter = Router();

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['TEXT', 'VOICE']),
  category: z.string().min(1).max(100).optional(),
  topic: z.string().max(500).optional().nullable(),
  is_private: z.boolean().optional(),
  access_user_ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

const updateChannelSchema = createChannelSchema
  .extend({
    position: z.number().int().min(0).max(1000).optional(),
    slowmode: z.number().int().min(0).max(300).optional(),
  })
  .partial();

channelsRouter.post(
  '/:serverId/channels',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const ctx = await requireServerPermission(userId, req.params.serverId, 'MANAGE_CHANNELS');
    const body = createChannelSchema.parse(req.body);
    const users = body.access_user_ids
      ? await prisma.user.findMany({ where: { id: { in: body.access_user_ids } }, select: { id: true } })
      : [];
    const channel = await prisma.channel.create({
      data: {
        serverId: req.params.serverId,
        name: body.name.trim(),
        type: body.type,
        category: (body.category ?? (body.type === 'VOICE' ? 'VOICE CHANNELS' : 'TEXT CHANNELS')).toUpperCase(),
        topic: body.topic?.trim() || null,
        isPrivate: body.is_private ?? false,
        ...(body.access_user_ids
          ? { accesses: { create: users.map((u) => ({ userId: u.id })) } }
          : {}),
      },
    });
    await writeAudit(req.params.serverId, userId, 'CHANNEL_CREATE', channel.name);
    emitToServer(req.params.serverId, 'server:updated', { server_id: req.params.serverId });
    void ctx;
    res.status(201).json({ channel: serializeChannel(channel) });
  }),
);

channelsRouter.patch(
  '/:channelId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await prisma.channel.findUnique({ where: { id: req.params.channelId } });
    if (!channel) throw notFound('Channel not found');
    const ctx = await requireServerPermission(userId, channel.serverId, 'MANAGE_CHANNELS');
    const body = updateChannelSchema.parse(req.body);
    if (body.access_user_ids) {
      const users = await prisma.user.findMany({
        where: { id: { in: body.access_user_ids } },
        select: { id: true },
      });
      await prisma.channelAccess.deleteMany({ where: { channelId: channel.id } });
      if (users.length > 0) {
        await prisma.channelAccess.createMany({
          data: users.map((u) => ({ channelId: channel.id, userId: u.id })),
        });
      }
    }
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.category !== undefined ? { category: body.category.toUpperCase() } : {}),
        ...(body.topic !== undefined ? { topic: body.topic?.trim() || null } : {}),
        ...(body.is_private !== undefined ? { isPrivate: body.is_private } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.slowmode !== undefined ? { slowmode: body.slowmode } : {}),
      },
    });
    await writeAudit(channel.serverId, userId, 'CHANNEL_UPDATE', updated.name);
    emitToServer(channel.serverId, 'server:updated', { server_id: channel.serverId });
    void ctx;
    res.json({ channel: serializeChannel(updated) });
  }),
);

channelsRouter.delete(
  '/:channelId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await prisma.channel.findUnique({ where: { id: req.params.channelId } });
    if (!channel) throw notFound('Channel not found');
    await requireServerPermission(userId, channel.serverId, 'MANAGE_CHANNELS');
    await prisma.channel.delete({ where: { id: channel.id } });
    if (channel.type === 'VOICE') {
      // Any radio session in this room dies with the room.
      radioManager.stopRoom(channel.id, 'channel_deleted');
    }
    await writeAudit(channel.serverId, userId, 'CHANNEL_DELETE', channel.name);
    emitToServer(channel.serverId, 'server:updated', { server_id: channel.serverId });
    res.status(204).end();
  }),
);

channelsRouter.get(
  '/:channelId/access',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await prisma.channel.findUnique({ where: { id: req.params.channelId } });
    if (!channel) throw notFound('Channel not found');
    await requireServerPermission(userId, channel.serverId, 'MANAGE_CHANNELS');
    const grants = await prisma.channelAccess.findMany({ where: { channelId: channel.id } });
    res.json({ access_user_ids: grants.map((g) => g.userId) });
  }),
);
