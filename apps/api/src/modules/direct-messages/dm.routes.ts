import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden, HttpError, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { serializeDmMessage, serializeUser } from '../../lib/serialize';
import { emitToUsers } from '../../realtime/socket-bus';
import { deleteObject } from '../../storage/s3';
import {
  attachmentKeyFromUrl,
  attachmentsInputSchema,
  buildConversationId,
  MAX_MESSAGE_CONTENT,
  reactionEmojiSchema,
} from '../../lib/validators';

export const dmRouter = Router();

const sendSchema = z.object({
  content: z.string().max(MAX_MESSAGE_CONTENT).default(''),
  reply_to_id: z.string().max(64).optional().nullable(),
  attachments: attachmentsInputSchema.optional(),
});

async function requireConversationAccess(conversationId: string, userId: string) {
  const latest = await prisma.directMessage.findFirst({
    where: { conversationId, participantIds: { has: userId } },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) throw notFound('Conversation not found');
  return latest;
}

async function assertNotBlocked(conversationId: string, userId: string): Promise<void> {
  const latest = await prisma.directMessage.findFirst({
    where: { conversationId, participantIds: { has: userId } },
    orderBy: { createdAt: 'desc' },
    select: { participantIds: true, isGroup: true },
  });
  if (!latest || latest.isGroup) return;
  const others = latest.participantIds.filter((id) => id !== userId);
  const blocked = await prisma.friend.findFirst({
    where: {
      status: 'BLOCKED',
      OR: [{ userId, friendId: { in: others } }, { userId: { in: others }, friendId: userId }],
    },
  });
  if (blocked) throw forbidden('You cannot message this conversation');
}

function conversationMetaPayload(
  conversationId: string,
  participantIds: string[],
  usersById: Map<string, { id: string; username: string; displayName: string; avatarUrl: string | null; avatarColor: string; bannerColor: string; status: string; customStatus: string | null; bio: string | null; createdAt: Date }>,
  isGroup: boolean,
  groupName: string | null,
  lastMessageAt: Date | null,
) {
  return {
    conversation_id: conversationId,
    participant_ids: participantIds,
    participants: participantIds.map((id) => {
      const user = usersById.get(id);
      return user ? serializeUser(user) : { id };
    }),
    is_group: isGroup,
    group_name: groupName,
    last_message_at: lastMessageAt?.toISOString() ?? null,
  };
}

dmRouter.get(
  '/conversations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const rows = await prisma.directMessage.findMany({
      where: { participantIds: { has: userId } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const conversations = new Map<
      string,
      { participantIds: string[]; isGroup: boolean; groupName: string | null; lastMessageAt: Date }
    >();
    for (const row of rows) {
      const existing = conversations.get(row.conversationId);
      if (!existing) {
        conversations.set(row.conversationId, {
          participantIds: [...row.participantIds],
          isGroup: row.isGroup,
          groupName: row.groupName,
          lastMessageAt: row.createdAt,
        });
      }
    }
    const allParticipants = new Set<string>();
    for (const conversation of conversations.values()) {
      for (const id of conversation.participantIds) allParticipants.add(id);
    }
    const users = allParticipants.size
      ? await prisma.user.findMany({ where: { id: { in: [...allParticipants] } } })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    res.json({
      conversations: [...conversations.entries()].map(([conversationId, meta]) =>
        conversationMetaPayload(
          conversationId,
          meta.participantIds,
          usersById,
          meta.isGroup,
          meta.groupName,
          meta.lastMessageAt,
        ),
      ),
    });
  }),
);

const createSchema = z.object({
  participant_ids: z.array(z.string().min(1).max(64)).min(1).max(49),
  group_name: z.string().min(1).max(64).optional(),
});

dmRouter.post(
  '/conversations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = createSchema.parse(req.body);
    const participantIds = [...new Set([userId, ...body.participantIds])].sort();
    const isGroup = participantIds.length > 2;
    if (body.group_name && !isGroup) throw new HttpError(400, 'Group name requires at least 3 participants');
    if (participantIds.length < 2) throw new HttpError(400, 'At least one other participant is required');

    const users = await prisma.user.findMany({ where: { id: { in: participantIds } } });
    if (users.length !== participantIds.length) throw new HttpError(400, 'Unknown participant');

    if (!isGroup) {
      const blocked = await prisma.friend.findFirst({
        where: {
          status: 'BLOCKED',
          OR: [
            { userId, friendId: { in: participantIds.filter((id) => id !== userId) } },
            { userId: { in: participantIds.filter((id) => id !== userId) }, friendId: userId },
          ],
        },
      });
      if (blocked) throw forbidden('You cannot start a conversation with this user');
    }

    const conversationId = buildConversationId(participantIds);
    const existing = await prisma.directMessage.findFirst({
      where: { conversationId },
      select: { id: true },
    });
    if (existing) {
      const usersById = new Map(users.map((u) => [u.id, u]));
      const last = await prisma.directMessage.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      res.json({
        conversation: conversationMetaPayload(
          conversationId,
          participantIds,
          usersById,
          isGroup,
          body.group_name ?? null,
          last?.createdAt ?? null,
        ),
        existed: true,
      });
      return;
    }

    const bootstrap = await prisma.directMessage.create({
      data: {
        conversationId,
        participantIds,
        senderId: userId,
        content: '',
        isGroup,
        groupName: body.group_name ?? null,
      },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));
    emitToUsers(participantIds.filter((id) => id !== userId), 'direct_message:conversation_new', {
      conversation: conversationMetaPayload(conversationId, participantIds, usersById, isGroup, bootstrap.groupName, bootstrap.createdAt),
    });
    res.status(201).json({
      conversation: conversationMetaPayload(
        conversationId,
        participantIds,
        usersById,
        isGroup,
        bootstrap.groupName,
        bootstrap.createdAt,
      ),
      existed: false,
    });
  }),
);

dmRouter.get(
  '/conversations/:conversationId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireConversationAccess(req.params.conversationId, userId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    if (before && Number.isNaN(before.getTime())) throw new HttpError(400, 'Invalid before cursor');
    const rows = await prisma.directMessage.findMany({
      where: {
        conversationId: req.params.conversationId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ messages: rows.reverse().map(serializeDmMessage), has_more: rows.length === limit });
  }),
);

dmRouter.post(
  '/conversations/:conversationId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const conversation = await requireConversationAccess(req.params.conversationId, userId);
    await assertNotBlocked(req.params.conversationId, userId);
    const body = sendSchema.parse(req.body);
    if (!body.content.trim() && !(body.attachments && body.attachments.length > 0)) {
      throw new HttpError(400, 'Message cannot be empty');
    }
    if (body.reply_to_id) {
      const parent = await prisma.directMessage.findFirst({
        where: { id: body.reply_to_id, conversationId: req.params.conversationId },
        select: { id: true },
      });
      if (!parent) throw new HttpError(400, 'Reply target not found in this conversation');
    }
    const message = await prisma.directMessage.create({
      data: {
        conversationId: req.params.conversationId,
        participantIds: [...conversation.participantIds],
        senderId: userId,
        content: body.content,
        replyToId: body.reply_to_id ?? null,
        isGroup: conversation.isGroup,
        groupName: conversation.groupName,
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
    const serialized = serializeDmMessage(message);
    emitToUsers(conversation.participantIds, 'direct_message:new', serialized);
    res.status(201).json({ message: serialized });
  }),
);

const renameSchema = z.object({ group_name: z.string().min(1).max(64) });

dmRouter.patch(
  '/conversations/:conversationId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const conversation = await requireConversationAccess(req.params.conversationId, userId);
    if (!conversation.isGroup) throw new HttpError(400, 'Only group conversations can be renamed');
    const body = renameSchema.parse(req.body);
    await prisma.directMessage.updateMany({
      where: { conversationId: req.params.conversationId },
      data: { groupName: body.group_name.trim() },
    });
    emitToUsers(conversation.participantIds, 'direct_message:conversation_updated', {
      conversation_id: req.params.conversationId,
      group_name: body.group_name.trim(),
    });
    res.json({ ok: true });
  }),
);

async function loadDmMessage(messageId: string, userId: string) {
  const message = await prisma.directMessage.findUnique({
    where: { id: messageId },
    include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
  });
  if (!message || !message.participantIds.includes(userId)) throw notFound('Message not found');
  return message;
}

dmRouter.patch(
  '/messages/:messageId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = sendSchema.pick({ content: true }).parse(req.body);
    const message = await loadDmMessage(req.params.messageId, userId);
    if (message.senderId !== userId) throw forbidden('You can only edit your own messages');
    const updated = await prisma.directMessage.update({
      where: { id: message.id },
      data: { content: body.content, edited: true },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    const serialized = serializeDmMessage(updated);
    emitToUsers(message.participantIds, 'direct_message:updated', serialized);
    res.json({ message: serialized });
  }),
);

dmRouter.delete(
  '/messages/:messageId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const message = await loadDmMessage(req.params.messageId, userId);
    if (message.senderId !== userId) throw forbidden('You can only delete your own messages');
    const attachments = await prisma.attachment.findMany({ where: { directMessageId: message.id } });
    await prisma.directMessage.delete({ where: { id: message.id } });
    for (const attachment of attachments) {
      await deleteObject(attachment.fileReference).catch(() => undefined);
    }
    emitToUsers(message.participantIds, 'direct_message:deleted', {
      id: message.id,
      conversation_id: message.conversationId,
    });
    res.json({ ok: true });
  }),
);

dmRouter.put(
  '/messages/:messageId/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = z.object({ emoji: reactionEmojiSchema }).parse(req.body);
    const message = await loadDmMessage(req.params.messageId, userId);
    try {
      await prisma.dmReaction.create({ data: { directMessageId: message.id, userId, emoji: body.emoji } });
    } catch {
      await prisma.dmReaction.deleteMany({
        where: { directMessageId: message.id, userId, emoji: body.emoji },
      });
    }
    const updated = await prisma.directMessage.findUnique({
      where: { id: message.id },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    if (!updated) throw notFound('Message not found');
    const serialized = serializeDmMessage(updated);
    emitToUsers(message.participantIds, 'direct_message:updated', serialized);
    res.json({ message: serialized });
  }),
);

dmRouter.post(
  '/messages/:messageId/pin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = z.object({ pinned: z.boolean() }).parse(req.body);
    const message = await loadDmMessage(req.params.messageId, userId);
    const updated = await prisma.directMessage.update({
      where: { id: message.id },
      data: { pinned: body.pinned },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
    });
    const serialized = serializeDmMessage(updated);
    emitToUsers(message.participantIds, 'direct_message:updated', serialized);
    res.json({ message: serialized });
  }),
);

dmRouter.get(
  '/conversations/:conversationId/pins',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await requireConversationAccess(req.params.conversationId, userId);
    const pins = await prisma.directMessage.findMany({
      where: { conversationId: req.params.conversationId, pinned: true },
      include: { author: true, attachments: true, reactions: { select: { emoji: true, userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ messages: pins.map(serializeDmMessage) });
  }),
);
