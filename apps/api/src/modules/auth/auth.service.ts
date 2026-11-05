import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';

/**
 * Session model:
 *  - Access token: short-lived HS256 JWT (subject = user id). Kept in client
 *    memory only — never in localStorage, never in a cookie.
 *  - Refresh token: opaque 32-byte random value, delivered in an HttpOnly
 *    SameSite=Lax cookie scoped to /api/auth. Stored server-side as SHA-256
 *    hash in the Session table and ROTATED on every refresh. A refresh attempt
 *    with an unknown token clears the cookie (theft detection signal).
 */

export const REFRESH_COOKIE_NAME = 'mg_refresh';

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.jwtSecret, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): string {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub) {
    throw new HttpError(401, 'Invalid or expired access token');
  }
  return payload.sub;
}

function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export interface IssuedSession {
  userId: string;
  accessToken: string;
  /** Raw refresh token (only ever placed into the HttpOnly cookie). */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function issueSession(
  userId: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<IssuedSession> {
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await prisma.session.create({
    data: {
      userId,
      refreshToken: hashRefreshToken(refreshToken),
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      ipAddress: context.ipAddress?.slice(0, 64) ?? null,
      expiresAt: refreshExpiresAt,
    },
  });
  return {
    userId,
    accessToken: signAccessToken(userId),
    refreshToken,
    refreshExpiresAt,
  };
}

/**
 * Rotate the session bound to the presented refresh cookie. Returns the new
 * tokens, or null when the cookie is missing/unknown/expired.
 */
export async function rotateSession(
  presentedToken: string | undefined,
  context: { userAgent?: string; ipAddress?: string },
): Promise<IssuedSession | null> {
  if (!presentedToken || presentedToken.length < 16 || presentedToken.length > 256) return null;
  const hash = hashRefreshToken(presentedToken);
  const session = await prisma.session.findUnique({ where: { refreshToken: hash } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const next = await issueSession(session.userId, context);
  await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
  return next;
}

export async function revokeSession(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  const hash = hashRefreshToken(presentedToken);
  await prisma.session.deleteMany({ where: { refreshToken: hash } });
}

export function refreshCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/api/auth',
    expires: expiresAt,
  };
}

export function clearingRefreshCookie() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/api/auth',
    expires: new Date(0),
  };
}

export function accessTokenExpiresAt(token: string): Date {
  const payload = jwt.decode(token) as { exp?: number } | null;
  const secondsLeft = payload?.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
  return new Date(Date.now() + Math.max(0, secondsLeft) * 1000);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    avatar_color: user.avatarColor,
    banner_color: user.bannerColor,
    status: user.status,
    custom_status: user.customStatus,
    bio: user.bio,
    created_at: user.createdAt.toISOString(),
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
