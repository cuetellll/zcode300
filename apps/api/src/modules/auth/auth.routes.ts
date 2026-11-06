import { Router } from 'express';
import { hash as argonHash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, unauthorized } from '../../lib/errors';
import { authLimiter } from '../../middleware/rate-limit';
import { requireAuth, sameOriginOrTrusted, getUserId } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import { validateAvatarDataUrl } from '../../lib/avatar';
import {
  REFRESH_COOKIE_NAME,
  clearingRefreshCookie,
  issueSession,
  publicUser,
  refreshCookieOptions,
  revokeSession,
  rotateSession,
} from './auth.service';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/, 'Username must be 3-32 chars (letters, digits, _ . -)'),
  display_name: z.string().min(1).max(64),
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
  avatar_url: z.string().max(400_000).optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(128),
});

function requestContext(req: { headers: Record<string, unknown>; ip?: string; socket: { remoteAddress?: string } }) {
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    ipAddress: req.ip ?? req.socket.remoteAddress ?? undefined,
  };
}

function allowedOrigins(): string[] {
  return env.CORS_ORIGIN ? [env.CORS_ORIGIN] : [];
}

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const username = body.username.toLowerCase();
    const email = body.email.toLowerCase();
    const avatarUrl = validateAvatarDataUrl(body.avatar_url);
    const passwordHash = await argonHash(body.password);

    const duplicate = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true, email: true },
    });
    if (duplicate) {
      if (duplicate.username === username) throw new HttpError(409, 'Username is already taken');
      throw new HttpError(409, 'Email is already registered');
    }

    const user = await prisma.user.create({
      data: {
        username,
        displayName: body.display_name.trim(),
        email,
        passwordHash,
        avatarUrl,
      },
    });

    const session = await issueSession(user.id, requestContext(req));
    res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions(session.refreshExpiresAt));
    res.status(201).json({
      access_token: session.accessToken,
      token_type: 'Bearer',
      expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
      user: publicUser(user),
    });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = user ? await verify(user.passwordHash, body.password).catch(() => false) : false;
    if (!user || !passwordOk) throw unauthorized('Invalid email or password');

    const session = await issueSession(user.id, requestContext(req));
    res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions(session.refreshExpiresAt));
    res.json({
      access_token: session.accessToken,
      token_type: 'Bearer',
      expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
      user: publicUser(user),
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    if (!sameOriginOrTrusted(req, allowedOrigins())) {
      throw new HttpError(403, 'Cross-site refresh rejected');
    }
    const token = (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME];
    logger.info('auth refresh attempt', { hadCookie: Boolean(token) });
    const next = await rotateSession(token, requestContext(req));
    logger.info('auth refresh result', { ok: Boolean(next) });
    if (!next) {
      res.cookie(REFRESH_COOKIE_NAME, '', clearingRefreshCookie());
      throw unauthorized('Session expired');
    }
    const user = await prisma.user.findUnique({ where: { id: next.userId }, select: { id: true } });
    if (!user) {
      await revokeSession(next.refreshToken).catch(() => undefined);
      res.cookie(REFRESH_COOKIE_NAME, '', clearingRefreshCookie());
      throw unauthorized('Account no longer exists');
    }
    res.cookie(REFRESH_COOKIE_NAME, next.refreshToken, refreshCookieOptions(next.refreshExpiresAt));
    res.json({ access_token: next.accessToken, token_type: 'Bearer', expires_in: env.ACCESS_TOKEN_TTL_SECONDS });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME];
    await revokeSession(token);
    res.cookie(REFRESH_COOKIE_NAME, '', clearingRefreshCookie());
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized('Account no longer exists');
    res.json({ user: publicUser(user) });
  }),
);
