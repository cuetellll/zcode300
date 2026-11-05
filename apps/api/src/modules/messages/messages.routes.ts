import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden, HttpError, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { requireChannelAccess } from '../../middleware/permissions';
import { serializeMessage } from '../../lib/serialize';
import { emitToChannel, emitToServer, emitToUser } from '../../realtime/socket-bus';
import { deleteObject } from '../../storage/s3';
import { attachmentKeyFromUrl, attachmentsInputSchema, MAX_MESSAGE_CONTENT, mentionsFromContent, reactionEmojiSchema } from '../../lib/validators';
import { writeAudit } from '../servers/servers.service';

export const messagesRouter = Router();

const sendSchema = z.object({
  content: z.string().max(MAX_MESSAGE_CONTENT).default(''),
  reply_to_id: z.string().max(64).optional().nullable(),
  attachments: attachmentsInputSchema.optional(),
});

const editSchema = z.object({ content: z.string().max(MAX_MESSAGE_CONTENT) });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export async function notifyMentions(
  content: string,
  candidateUserIds: string[],
  payload: { title: string; body: string; type: string },
): Promise<void> {
  const { userIds, everyone } = mentionsFromContent(content);
  if (!everyone && userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const targets = new Set(users.map((u) => u.id));
  if (everyone) {
    for (const candidate of candidateUserIds) targets.add(candidate);
  }
  for (const targetId of targets) {
    const notification = await prisma.notification.create({
      data: { userId: targetId, title: payload.title, body: payload.body, type: payload.type },
    });
    emitToUser(targetId, 'notification:new', {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      read: false,
      created_at: notification.createdAt.toISOString(),
    });
  }
}

export async function deleteMessageAttachments(attachmentRefs: string[]): Promise<void> {
  for (const ref of attachmentRefs) {
    if (!ref.startsWith('https://')) await deleteObject(ref).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Channel messages
// ---------------------------------------------------------------------------

messagesRouter.get(
  '/channels/:channelId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await requireChannelAccess(userId, req.params.channelId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    if (before && Number.isNaN(before.getTime())) throw new HttpError(400, 'Invalid before cursor');
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 64) : '';

    const messages = await prisma.message.findMany({
      where: {
        channelId: channel.id,
        ...(before ? { createdAt: { lt: before } } : {}),
        ...(search ? { content: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        author: true,
        attachments: true,
        reactions: { select: { emoji: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      messages: messages.reverse().map(serializeMessage),
      has_more: messages.length === limit,
    });
  }),
);

messagesRouter.post(
  '/channels/:channelId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await requireChannelAccess(userId, req.params.channelId);
    await requireChannelPermissionToSend(userId, channel.serverId);
    const body = sendSchema.parse(req.body);
    if (!body.content.trim() && !(body.attachments && body.attachments.length > 0)) {
      throw new HttpError(400, 'Message cannot be empty');
    }

    // Slowmode (server-enforced, not cosmetic).
    if (channel.slowmode > 0) {
      const last = await prisma.message.findFirst({
        where: { channelId: channel.id, userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last) {
        const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
        if (elapsed < channel.slowmode) {
          throw new HttpError(429, 'Slowmode is active for this channel', 'SLOWMODE_ACTIVE', {
            retry_after: Math.ceil(channel.slowmode - elapsed),
          });
        }
      }
    }

    if (body.reply_to_id) {
      const parent = await prisma.message.findFirst({
        where: { id: body.reply_to_id, channelId: channel.id },
        select: { id: true },
      });
      if (!parent) throw new HttpError(400, 'Reply target not found in this channel');
    }

    const members = await prisma.serverMember.findMany({
      where: { serverId: channel.serverId },
      select: { userId: true },
    });

    const message = await prisma.message.create({
      data: {
        channelId: channel.id,
        userId,
        content: body.content,
        replyToId: body.reply_to_id ?? null,
        ...(body.attachments && body.attachments.length > 0
          ? {
              attachments: {
                create: body.attachments.map((a) => ({
                  fileReference: attachmentKeyFromUrl(a.url),
                  fileName: a.name,
                  contentType: a.content_type,
                  fileSize: a.size,
                })),
              },
            }
          : {}),
      },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });

    const serialized = serializeMessage(message);
    emitToChannel(channel.id, 'message:new', serialized);
    emitToServer(channel.serverId, 'message:new', serialized); // sidebar unread updates
    await notifyMentions(body.content, members.map((m) => m.userId).filter((id) => id !== userId), {
      title: `Mention in #${channel.name}`,
      body: body.content.slice(0, 200) || '(attachment)',
      type: 'mention',
    });
    res.status(201).json({ message: serialized });
  }),
);

async function requireChannelPermissionToSend(userId: string, serverId: string): Promise<void> {
  const { getMemberContext, memberHasPermission } = await import('../../middleware/permissions');
  const ctx = await getMemberContext(userId, serverId);
  if (!memberHasPermission(ctx, 'SEND_MESSAGES')) throw forbidden('Missing server permission: SEND_MESSAGES');
}

async function loadChannelMessage(messageId: string, userId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { channel: true },
  });
  if (!message) throw notFound('Message not found');
  const { canAccessChannel, getMemberContext, memberHasPermission } = await import('../../middleware/permissions');
  if (!(await canAccessChannel(userId, message.channel))) throw forbidden('No access to this channel');
  const ctx = await getMemberContext(userId, message.channel.serverId);
  return { message, ctx, memberHasPermission };
}

messagesRouter.patch(
  '/messages/:messageId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = editSchema.parse(req.body);
    const { message } = await loadChannelMessage(req.params.messageId, userId);
    if (message.userId !== userId) throw forbidden('You can only edit your own messages');
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { content: body.content, edited: true },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    const serialized = serializeMessage(updated);
    emitToChannel(message.channelId, 'message:updated', serialized);
    res.json({ message: serialized });
  }),
);

messagesRouter.delete(
  '/messages/:messageId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { message, ctx, memberHasPermission: has } = await loadChannelMessage(req.params.messageId, userId);
    const canManage = has(ctx, 'MANAGE_MESSAGES');
    if (message.userId !== userId && !canManage) throw forbidden('You cannot delete this message');
    const attachments = await prisma.attachment.findMany({ where: { messageId: message.id } });
    await prisma.message.delete({ where: { id: message.id } });
    await deleteMessageAttachments(attachments.map((a) => a.fileReference));
    if (canManage && message.userId !== userId) {
      await writeAudit(message.channel.serverId, userId, 'MESSAGE_DELETE_MANAGED', message.channel.name);
    }
    emitToChannel(message.channelId, 'message:deleted', { id: message.id, channel_id: message.channelId });
    res.json({ ok: true });
  }),
);

/** Toggle a reaction server-side (no client-side JSON merging races). */
messagesRouter.put(
  '/messages/:messageId/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = z.object({ emoji: reactionEmojiSchema }).parse(req.body);
    const { message } = await loadChannelMessage(req.params.messageId, userId);
    await requireChannelPermissionToSend(userId, message.channel.serverId);

    try {
      await prisma.reaction.create({ data: { messageId: message.id, userId, emoji: body.emoji } });
    } catch {
      await prisma.reaction.deleteMany({
        where: { messageId: message.id, userId, emoji: body.emoji },
      });
    }
    const updated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    if (!updated) throw notFound('Message not found');
    const serialized = serializeMessage(updated);
    emitToChannel(message.channelId, 'message:updated', serialized);
    res.json({ message: serialized });
  }),
);

messagesRouter.post(
  '/messages/:messageId/pin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = z.object({ pinned: z.boolean() }).parse(req.body);
    const { message, ctx, memberHasPermission: has } = await loadChannelMessage(req.params.messageId, userId);
    if (message.userId !== userId && !has(ctx, 'MANAGE_MESSAGES')) throw forbidden('You cannot pin this message');
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { pinned: body.pinned },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    const serialized = serializeMessage(updated);
    emitToChannel(message.channelId, 'message:updated', serialized);
    res.json({ message: serialized });
  }),
);

messagesRouter.get(
  '/channels/:channelId/pins',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channel = await requireChannelAccess(userId, req.params.channelId);
    const pins = await prisma.message.findMany({
      where: { channelId: channel.id, pinned: true },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ messages: pins.map(serializeMessage) });
  }),
);
