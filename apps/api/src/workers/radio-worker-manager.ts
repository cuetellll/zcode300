import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { AccessToken } from 'livekit-server-sdk';
import { env, radioWorkerEntry, radioWorkerPython } from '../config/env';
import {
  RADIO_BOT_NAME,
  findRadioStation,
  radioBotIdentity,
  type RadioStation,
} from '../config/radio-stations';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export type RadioSessionStatus = 'starting' | 'live' | 'error' | 'stopping';

export interface RadioState {
  channel_id: string;
  server_id: string;
  status: RadioSessionStatus;
  station_id: string | null;
  station_title: string | null;
  listeners: number;
  error: string | null;
}

/**
 * Worker -> manager protocol (stdout JSON lines). Manager -> worker (stdin):
 * init / switch / stop. Defined alongside workers/radio/protocol.py.
 */
interface WorkerMessage {
  type: 'ready' | 'switching' | 'live' | 'status' | 'error' | 'exited';
  station_id?: string;
  humans?: number;
  message?: string;
  fatal?: boolean;
  reason?: string;
}

interface RadioSession {
  channelId: string;
  serverId: string;
  status: RadioSessionStatus;
  stationId: string;
  stationTitle: string;
  listeners: number;
  error: string | null;
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  lastHeartbeatAt: number;
  stopRequested: boolean;
  idleTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  lineBuffer: string;
}

const SWITCH_WARM_HINT = 'Station change in progress';

/**
 * Owns the lazy radio worker child processes. Nothing runs at boot: the first
 * validated play command spawns one Python worker per voice room, and the
 * last one is torn down after the idle timeout. Only one stream is allowed
 * per room; the total number of concurrent rooms is capped via env.
 */
export class RadioWorkerManager {
  private readonly sessions = new Map<string, RadioSession>();
  private watchdog: NodeJS.Timeout | null = null;

  constructor(private readonly broadcast: (channelId: string, state: RadioState) => void) {}

  get enabled(): boolean {
    return env.RADIO_ENABLED && Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!env.LIVEKIT_URL) missing.push('LIVEKIT_URL');
    if (!env.LIVEKIT_API_KEY) missing.push('LIVEKIT_API_KEY');
    if (!env.LIVEKIT_API_SECRET) missing.push('LIVEKIT_API_SECRET');
    return missing;
  }

  activeRoomCount(): number {
    return this.sessions.size;
  }

  getPublicState(channelId: string): RadioState | null {
    const session = this.sessions.get(channelId);
    if (!session) return null;
    return this.snapshot(session);
  }

  snapshot(session: RadioSession): RadioState {
    return {
      channel_id: session.channelId,
      server_id: session.serverId,
      status: session.status,
      station_id: session.stationId,
      station_title: session.stationTitle,
      listeners: session.listeners,
      error: session.error,
    };
  }

  /** Start (or switch) the shared room stream. Throws typed HttpErrors. */
  async playOrSwitch(channelId: string, serverId: string, stationId: string): Promise<RadioState> {
    if (!env.RADIO_ENABLED) throw new HttpError(403, 'Radio is disabled on this deployment', 'RADIO_DISABLED');
    if (!this.enabled) {
      throw new HttpError(503, 'Radio is not configured on the server', 'RADIO_NOT_CONFIGURED', {
        missing: this.missingConfig(),
      });
    }
    const station = findRadioStation(stationId);
    if (!station) throw new HttpError(404, 'Unknown radio station', 'RADIO_STATION_NOT_FOUND');

    const existing = this.sessions.get(channelId);
    if (existing) {
      if (existing.stationId === stationId && existing.status === 'live') {
        return this.snapshot(existing);
      }
      existing.status = 'starting';
      existing.stationId = station.id;
      existing.stationTitle = station.title;
      existing.error = SWITCH_WARM_HINT;
      this.send(existing, {
        type: 'switch',
        station_id: station.id,
        station_title: station.title,
        station_url: station.streamUrl,
      });
      this.publish(existing);
      return this.snapshot(existing);
    }

    if (this.sessions.size >= env.RADIO_MAX_ACTIVE_ROOMS) {
      throw new HttpError(
        429,
        `Radio capacity is full (${env.RADIO_MAX_ACTIVE_ROOMS} active room). Stop another room's radio first.`,
        'RADIO_CAPACITY_FULL',
      );
    }

    const session = await this.spawnSession(channelId, serverId, station);
    this.sessions.set(channelId, session);
    this.publish(session);
    this.ensureWatchdog();
    return this.snapshot(session);
  }

  /** Manual stop (user action, channel deletion, shutdown). */
  stopRoom(channelId: string, reason: string): void {
    const session = this.sessions.get(channelId);
    if (!session) return;
    session.stopRequested = true;
    session.status = 'stopping';
    this.publish(session);
    this.send(session, { type: 'stop' });
    session.killTimer = setTimeout(() => this.forceKill(session, reason), 6000);
    session.killTimer.unref();
    if (reason === 'idle') {
      logger.info('radio idle shutdown', { channelId });
    } else {
      logger.info('radio stop requested', { channelId, reason });
    }
  }

  private forceKill(session: RadioSession, reason: string): void {
    if (session.child.exitCode !== null) return;
    logger.warn('radio worker force kill', { channelId: session.channelId, reason });
    session.child.kill('SIGKILL');
  }

  /** Graceful shutdown of every worker (SIGTERM/deploy). */
  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.stopRequested = true;
      this.send(session, { type: 'stop' });
      const killer = setTimeout(() => session.child.kill('SIGKILL'), 3000);
      killer.unref();
    }
  }

  // -- internals ------------------------------------------------------------

  private async spawnSession(channelId: string, serverId: string, station: RadioStation): Promise<RadioSession> {
    const identity = radioBotIdentity(channelId);
    const token = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
      identity,
      name: RADIO_BOT_NAME,
      ttl: '12h',
      metadata: JSON.stringify({ kind: 'radio-bot', channel_id: channelId }),
    });
    token.addGrant({
      roomJoin: true,
      room: channelId,
      canPublish: true,
      canPublishSources: ['microphone'],
      canSubscribe: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    const livekitToken = await token.toJwt();

    const entry = radioWorkerEntry();
    const python = radioWorkerPython();
    const child = spawn(python, [entry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }) as ChildProcessWithoutNullStreams;

    const session: RadioSession = {
      channelId,
      serverId,
      status: 'starting',
      stationId: station.id,
      stationTitle: station.title,
      listeners: 0,
      error: null,
      child,
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      stopRequested: false,
      idleTimer: null,
      killTimer: null,
      lineBuffer: '',
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onWorkerStdout(session, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) logger.info(`[radio-worker:${channelId}] ${line.trim()}`);
      }
    });
    child.on('error', (error) => {
      logger.error('radio worker spawn error', { channelId, error: String(error) });
      this.failSession(session, 'Radio worker could not be started', 'RADIO_WORKER_SPAWN_FAILED');
    });
    child.on('exit', (code, signal) => this.onWorkerExit(session, code, signal));

    this.send(session, {
      type: 'init',
      room_id: channelId,
      livekit_url: env.LIVEKIT_URL,
      token: livekitToken,
      identity,
      name: RADIO_BOT_NAME,
      station_id: station.id,
      station_title: station.title,
      station_url: station.streamUrl,
    });
    logger.info('radio worker started', { channelId, stationId: station.id });
    return session;
  }

  private onWorkerStdout(session: RadioSession, chunk: string): void {
    session.lineBuffer += chunk;
    let newlineIndex = session.lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = session.lineBuffer.slice(0, newlineIndex).trim();
      session.lineBuffer = session.lineBuffer.slice(newlineIndex + 1);
      if (line) this.handleWorkerMessage(session, line);
      newlineIndex = session.lineBuffer.indexOf('\n');
    }
  }

  private handleWorkerMessage(session: RadioSession, line: string): void {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch {
      logger.warn('radio worker sent malformed protocol line', { channelId: session.channelId });
      return;
    }
    session.lastHeartbeatAt = Date.now();

    switch (message.type) {
      case 'ready':
        break;
      case 'switching':
        session.status = 'starting';
        if (message.station_id) session.stationId = message.station_id;
        session.error = SWITCH_WARM_HINT;
        this.publish(session);
        break;
      case 'live': {
        session.status = 'live';
        session.error = null;
        if (message.station_id) {
          session.stationId = message.station_id;
          session.stationTitle = findRadioStation(message.station_id)?.title ?? session.stationTitle;
        }
        this.clearIdleTimer(session);
        this.publish(session);
        logger.info('radio stream live', { channelId: session.channelId, stationId: session.stationId });
        break;
      }
      case 'status':
        if (typeof message.humans === 'number') {
          this.updateListeners(session, message.humans);
        }
        break;
      case 'error':
        if (message.fatal) {
          this.failSession(session, message.message ?? 'Radio stream failed', 'RADIO_STREAM_FAILED');
        } else {
          session.error = message.message ?? 'Radio error';
          this.publish(session);
        }
        break;
      case 'exited':
        this.teardownSession(session, 'stopped');
        break;
    }
  }

  private onWorkerExit(session: RadioSession, code: number | null, signal: string | null): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.killTimer) clearTimeout(session.killTimer);
    if (!this.sessions.has(session.channelId)) return; // already torn down
    if (session.stopRequested) {
      this.teardownSession(session, 'stopped');
      return;
    }
    logger.error('radio worker exited unexpectedly', { channelId: session.channelId, code, signal });
    this.teardownSession(session, 'error', 'Radio stream stopped unexpectedly. Try again.');
  }

  private failSession(session: RadioSession, message: string, _code: string): void {
    session.stopRequested = true;
    const killer = setTimeout(() => session.child.kill('SIGKILL'), 4000);
    killer.unref();
    this.teardownSession(session, 'error', message);
  }

  private teardownSession(
    session: RadioSession,
    status: RadioSessionStatus,
    errorMessage?: string,
  ): void {
    if (!this.sessions.has(session.channelId)) return;
    this.sessions.delete(session.channelId);
    const finalState: RadioState = {
      channel_id: session.channelId,
      server_id: session.serverId,
      status,
      station_id: status === 'error' ? session.stationId : null,
      station_title: status === 'error' ? session.stationTitle : null,
      listeners: 0,
      error: errorMessage ?? null,
    };
    this.broadcast(session.channelId, finalState);
    logger.info('radio session removed', { channelId: session.channelId, status });
    if (this.sessions.size === 0 && this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private updateListeners(session: RadioSession, humans: number): void {
    const previous = session.listeners;
    session.listeners = Math.max(0, humans);
    if (session.listeners > 0) {
      this.clearIdleTimer(session);
    } else if (previous > 0 && !session.idleTimer && session.status === 'live') {
      const timer = setTimeout(() => {
        session.idleTimer = null;
        this.stopRoom(session.channelId, 'idle');
      }, env.RADIO_IDLE_SHUTDOWN_MS);
      timer.unref();
      session.idleTimer = timer;
      logger.info('radio room empty — idle countdown started', {
        channelId: session.channelId,
        idleMs: env.RADIO_IDLE_SHUTDOWN_MS,
      });
    }
    if (previous !== session.listeners) this.publish(session);
  }

  private clearIdleTimer(session: RadioSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  private ensureWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const session of this.sessions.values()) {
        if (now - session.lastHeartbeatAt > env.RADIO_HEARTBEAT_TIMEOUT_MS) {
          logger.error('radio worker heartbeat timeout', { channelId: session.channelId });
          session.stopRequested = true;
          session.child.kill('SIGKILL');
          this.teardownSession(session, 'error', 'Radio worker became unresponsive.');
        }
      }
      if (this.sessions.size === 0 && this.watchdog) {
        clearInterval(this.watchdog);
        this.watchdog = null;
      }
    }, 15_000);
    this.watchdog.unref();
  }

  private publish(session: RadioSession): void {
    this.broadcast(session.channelId, this.snapshot(session));
  }

  private send(session: RadioSession, message: Record<string, unknown>): void {
    if (session.child.stdin.destroyed) return;
    session.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
