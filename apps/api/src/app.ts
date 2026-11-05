import path from 'node:path';
import fs from 'node:fs';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { HttpError } from './lib/errors';
import { apiLimiter, authLimiter } from './middleware/rate-limit';
import { onlineUserIds } from './realtime';
import { radioManager } from './modules/radio/radio.context';

import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { serversRouter, invitesRouter } from './modules/servers/servers.routes';
import { channelsRouter } from './modules/channels/channels.routes';
import { messagesRouter } from './modules/messages/messages.routes';
import { dmRouter } from './modules/direct-messages/dm.routes';
import { friendsRouter } from './modules/friends/friends.routes';
import { filesRouter } from './modules/files/files.routes';
import { voiceRouter } from './modules/voice/voice.routes';
import { radioRouter } from './modules/radio/radio.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';

export function buildApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const storageEndpointOrigin = (() => {
    const endpoint = (process.env.AWS_ENDPOINT_URL ?? '').trim();
    try {
      return endpoint ? new URL(endpoint).origin : null;
    } catch {
      return null;
    }
  })();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
          fontSrc: ["'self'", 'fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: [
            "'self'",
            'wss:',
            'https:',
            ...(storageEndpointOrigin ? [storageEndpointOrigin] : []),
          ],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const corsOrigin = env.CORS_ORIGIN ? env.CORS_ORIGIN : false;
  app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }));
  app.use(compression());
  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());

  // -- health (outside rate limits; real DB ping, not just liveness) ----------
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        service: 'mahyar-gap',
        online_users: onlineUserIds().length,
        radio_active_rooms: radioManager.activeRoomCount(),
        uptime_seconds: Math.floor(process.uptime()),
      });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api', apiLimiter);
  app.use('/api/users', usersRouter);
  app.use('/api/servers', serversRouter);
  app.use('/api/invites', invitesRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api', messagesRouter);
  app.use('/api/dm', dmRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/voice', voiceRouter);
  app.use('/api/radio', radioRouter);
  app.use('/api/notifications', notificationsRouter);

  // -- web static (production SPA) — MUST be registered before the 404 handler
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/|auth\/).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // -- 404 -------------------------------------------------------------------
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }
    res.status(404).send('Not found');
  });

  // -- errors ----------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Invalid request',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(409).json({ error: 'This value already exists' });
        return;
      }
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.status(400).json({ error: 'Database request failed' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
      return;
    }
    const errorId = Math.random().toString(36).slice(2, 10);
    logger.error('unhandled error', { errorId, message: (error as Error)?.message, stack: (error as Error)?.stack });
    res.status(500).json({ error: 'Internal server error', errorId });
  });

  return app;
}
