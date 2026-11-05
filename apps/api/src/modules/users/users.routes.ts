import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { validateAvatarDataUrl } from '../../lib/avatar';
import { serializeUser } from '../../lib/serialize';

export const usersRouter = Router();

const updateMeSchema = z.object({
  display_name: z.string().min(1).max(64).optional(),
  avatar_url: z.string().max(400_000).optional().nullable(),
  status: z.enum(['ONLINE', 'IDLE', 'DND', 'OFFLINE']).optional(),
  custom_status: z.string().max(128).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
});

usersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 64) : '';
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { displayName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { username: 'asc' },
      take: limit,
    });
    res.json({ users: users.map(serializeUser) });
  }),
);

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = updateMeSchema.parse(req.body);
    const avatarUrl = 'avatar_url' in body ? validateAvatarDataUrl(body.avatar_url) : undefined;
    const data = {
      ...(body.display_name !== undefined ? { displayName: body.display_name.trim() } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.custom_status !== undefined ? { customStatus: body.custom_status?.trim() || null } : {}),
      ...(body.bio !== undefined ? { bio: body.bio?.trim() || null } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    };
    const user = await prisma.user.update({ where: { id: userId }, data });
    res.json({ user: serializeUser(user) });
  }),
);

usersRouter.get(
  '/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound('User not found');
    res.json({ user: serializeUser(user) });
  }),
);
