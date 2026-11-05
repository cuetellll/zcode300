import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, forbidden, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { serializeUser } from '../../lib/serialize';
import { emitToUser } from '../../realtime/socket-bus';

export const friendsRouter = Router();

const addSchema = z.object({ username: z.string().min(3).max(32) });

friendsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const edges = await prisma.friend.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const reverseEdges = await prisma.friend.findMany({
      where: { friendId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const otherIds = new Set<string>();
    for (const edge of [...edges, ...reverseEdges]) {
      otherIds.add(edge.userId === userId ? edge.friendId : edge.userId);
    }
    const users = otherIds.size ? await prisma.user.findMany({ where: { id: { in: [...otherIds] } } }) : [];
    const usersById = new Map(users.map((u) => [u.id, u]));

    const friends = edges
      .filter((edge) => edge.status === 'ACCEPTED')
      .map((edge) => ({ user: usersById.get(edge.friendId) ? serializeUser(usersById.get(edge.friendId)!) : null, since: edge.createdAt.toISOString() }))
      .filter((entry) => entry.user !== null);

    const incoming = reverseEdges
      .filter((edge) => edge.status === 'PENDING')
      .filter((edge) => !edges.some((mine) => mine.friendId === edge.userId && mine.status === 'BLOCKED'))
      .map((edge) => ({ request_id: edge.id, user: usersById.get(edge.userId) ? serializeUser(usersById.get(edge.userId)!) : null }));

    const outgoing = edges
      .filter((edge) => edge.status === 'PENDING')
      .map((edge) => ({ request_id: edge.id, user: usersById.get(edge.friendId) ? serializeUser(usersById.get(edge.friendId)!) : null }));

    const blocked = edges
      .filter((edge) => edge.status === 'BLOCKED')
      .map((edge) => ({ user: usersById.get(edge.friendId) ? serializeUser(usersById.get(edge.friendId)!) : null }));

    res.json({
      friends: friends.filter((f) => f.user),
      incoming_requests: incoming.filter((r) => r.user),
      outgoing_requests: outgoing.filter((r) => r.user),
      blocked: blocked.filter((b) => b.user),
    });
  }),
);

friendsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = addSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { username: body.username.toLowerCase() } });
    if (!target) throw notFound('No user found with that username');
    if (target.id === userId) throw badRequest('You cannot add yourself');

    const mine = await prisma.friend.findUnique({ where: { userId_friendId: { userId, friendId: target.id } } });
    const theirs = await prisma.friend.findUnique({ where: { userId_friendId: { userId: target.id, friendId: userId } } });

    if (mine?.status === 'BLOCKED' || theirs?.status === 'BLOCKED') {
      throw forbidden('This user is blocked');
    }
    if (mine?.status === 'ACCEPTED' && theirs?.status === 'ACCEPTED') {
      throw badRequest('You are already friends');
    }
    // They already sent us a request — accept it instead.
    if (theirs?.status === 'PENDING') {
      await prisma.$transaction([
        prisma.friend.update({ where: { id: theirs.id }, data: { status: 'ACCEPTED' } }),
        prisma.friend.upsert({
          where: { userId_friendId: { userId, friendId: target.id } },
          update: { status: 'ACCEPTED' },
          create: { userId, friendId: target.id, status: 'ACCEPTED' },
        }),
      ]);
      emitToUser(target.id, 'friends:updated', { kind: 'request_accepted', user_id: userId });
      res.json({ status: 'accepted', user: serializeUser(target) });
      return;
    }
    if (mine?.status === 'PENDING') throw badRequest('Friend request already sent');

    const request = await prisma.friend.upsert({
      where: { userId_friendId: { userId, friendId: target.id } },
      update: { status: 'PENDING' },
      create: { userId, friendId: target.id, status: 'PENDING' },
    });
    const notification = await prisma.notification.create({
      data: {
        userId: target.id,
        title: 'Friend request',
        body: 'You have a new friend request.',
        type: 'friend_request',
      },
    });
    emitToUser(target.id, 'notification:new', {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      read: false,
      created_at: notification.createdAt.toISOString(),
    });
    emitToUser(target.id, 'friends:updated', { kind: 'request_received', user_id: userId, request_id: request.id });
    res.status(201).json({ status: 'pending', user: serializeUser(target) });
  }),
);

friendsRouter.post(
  '/requests/:requesterId/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const requesterId = req.params.requesterId;
    const request = await prisma.friend.findUnique({
      where: { userId_friendId: { userId: requesterId, friendId: userId } },
    });
    if (!request || request.status !== 'PENDING') throw notFound('No pending request from this user');
    await prisma.$transaction([
      prisma.friend.update({ where: { id: request.id }, data: { status: 'ACCEPTED' } }),
      prisma.friend.upsert({
        where: { userId_friendId: { userId, friendId: requesterId } },
        update: { status: 'ACCEPTED' },
        create: { userId, friendId: requesterId, status: 'ACCEPTED' },
      }),
    ]);
    emitToUser(requesterId, 'friends:updated', { kind: 'request_accepted', user_id: userId });
    res.json({ status: 'accepted' });
  }),
);

friendsRouter.delete(
  '/requests/:otherId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const otherId = req.params.otherId;
    await prisma.friend.deleteMany({
      where: {
        status: 'PENDING',
        OR: [
          { userId: otherId, friendId: userId },
          { userId, friendId: otherId },
        ],
      },
    });
    emitToUser(otherId, 'friends:updated', { kind: 'request_removed', user_id: userId });
    res.status(204).end();
  }),
);

friendsRouter.delete(
  '/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const otherId = req.params.userId;
    const removed = await prisma.friend.deleteMany({
      where: {
        OR: [
          { userId, friendId: otherId },
          { userId: otherId, friendId: userId },
        ],
      },
    });
    if (removed.count === 0) throw notFound('No relationship with this user');
    emitToUser(otherId, 'friends:updated', { kind: 'friend_removed', user_id: userId });
    res.status(204).end();
  }),
);

friendsRouter.post(
  '/:userId/block',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const otherId = req.params.userId;
    if (otherId === userId) throw badRequest('You cannot block yourself');
    const target = await prisma.user.findUnique({ where: { id: otherId } });
    if (!target) throw notFound('User not found');
    await prisma.$transaction([
      prisma.friend.deleteMany({
        where: {
          OR: [
            { userId, friendId: otherId },
            { userId: otherId, friendId: userId },
          ],
        },
      }),
      prisma.friend.upsert({
        where: { userId_friendId: { userId, friendId: otherId } },
        update: { status: 'BLOCKED' },
        create: { userId, friendId: otherId, status: 'BLOCKED' },
      }),
    ]);
    emitToUser(otherId, 'friends:updated', { kind: 'blocked', user_id: userId });
    res.json({ blocked: true });
  }),
);

friendsRouter.post(
  '/:userId/unblock',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await prisma.friend.deleteMany({
      where: { userId, friendId: req.params.userId, status: 'BLOCKED' },
    });
    res.json({ blocked: false });
  }),
);
