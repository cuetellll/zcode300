import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { buildApp } from './app';
import { socketBus } from './realtime/socket-bus';
import { attachRealtime } from './realtime';
import { radioManager } from './modules/radio/radio.context';

process.env.MAHYAR_BOOT_EPOCH = String(Date.now());

const app = buildApp();
const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: {
    origin: env.CORS_ORIGIN ?? false,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6,
});

socketBus.io = io;
attachRealtime(io);

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info('mahyar-gap api listening', {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    radioEnabled: radioManager.enabled,
    radioMaxRooms: env.RADIO_MAX_ACTIVE_ROOMS,
    radioIdleMs: env.RADIO_IDLE_SHUTDOWN_MS,
  });
});

let shuttingDown = false;

async function shutdownGracefully(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('graceful shutdown started', { signal });

  // 1. Stop accepting new work.
  server.close(() => logger.info('http server closed'));
  io.disconnectSockets(true);

  // 2. Tear down radio workers (FFmpeg children + LiveKit connections).
  try {
    radioManager.stopAll();
  } catch (error) {
    logger.warn('radio shutdown error', { error: String(error) });
  }

  // 3. Close the database pool.
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.warn('prisma disconnect error', { error: String(error) });
  }

  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => void shutdownGracefully('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', { error: error.message, stack: error.stack });
  void shutdownGracefully('uncaughtException');
});
