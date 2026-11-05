import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../modules/auth/auth.service';

export interface AuthedRequest extends Request {
  userId: string;
}

/** Require a valid Bearer access token. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
  if (!match) {
    next(unauthorized());
    return;
  }
  try {
    (req as AuthedRequest).userId = verifyAccessToken(match[1].trim());
    next();
  } catch {
    next(unauthorized('Invalid or expired access token'));
  }
}

export function getUserId(req: Request): string {
  const userId = (req as AuthedRequest).userId;
  if (!userId) throw unauthorized();
  return userId;
}

/**
 * Origin check for cookie-authenticated endpoints (CSRF defence on top of
 * SameSite=Lax). Same-origin requests and same-host https/http upgrades pass.
 */
export function sameOriginOrTrusted(req: Request, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients / same-origin fetch without CORS
  if (allowedOrigins.includes(origin)) return true;
  try {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (host && new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return false;
}
