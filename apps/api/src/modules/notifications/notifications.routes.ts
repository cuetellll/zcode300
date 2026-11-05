import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const unreadOnly = req.query.unread_only === 'true';
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, ...(unreadOnly ? { read: false } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);
    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        read: n.read,
        created_at: n.createdAt.toISOString(),
      })),
      unread_count: unreadCount,
    });
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const result = await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    res.json({ updated: result.count });
  }),
);
