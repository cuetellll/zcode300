/**
 * Per-participant audio graph (Web Audio API).
 *
 * Why this exists
 * ---------------
 * LiveKit's `RemoteAudioTrack.setVolume()` simply assigns `HTMLMediaElement
 * .volume`, which the browser clamps to 0..1 and which can only be applied to
 * an element created by `track.attach()`. That made it impossible to give a
 * single user (or the radio) more than 100% and it fought with the hidden
 * `<audio>` element whose volume nobody else owned.
 *
 * Here every subscribed audio track is routed through its own GainNode:
 *
 *     MediaStreamTrack -> MediaStreamSource -> Analyser -> Gain -> Output
 *
 *  * the gain lives in 0..2 (0–200%), so per-user and radio volume is exact;
 *  * the analyser gives us a real signal level for Discord's green speaking
 *    ring (instead of trusting `isSpeaking`, which is ~300ms laggy);
 *  * muting a user is `gain = 0`, so it cannot be undone by a re-attach.
 *
 * Nothing here touches the network: the source is a WebRTC MediaStreamTrack,
 * never a cross-origin <audio src>, so `createMediaElementSource` + CORS
 * silence is not possible.
 */

type TrackRole = 'mic' | 'screen' | 'radio';

interface Channel {
  key: string;
  identity: string;
  role: TrackRole;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  sink: GainNode | null;
  /**
   * Chrome quirk: a REMOTE WebRTC track consumed only through
   * createMediaStreamSource can stay silent unless the track also plays
   * through an element. This muted keep-alive element keeps the media
   * flowing; the audible output comes from the graph, so it stays muted.
   */
  keepAlive: HTMLAudioElement;
  /** Web Audio's getFloatTimeDomainData requires a non-shared buffer. */
  buffer: Float32Array<ArrayBuffer>;
}

export interface LevelUpdate {
  identity: string;
  level: number;
}

const LEVEL_INTERVAL_MS = 90;
/** RMS below this is treated as silence (mic noise floor). */
const SPEAKING_THRESHOLD = 0.012;

export class VoiceAudioEngine {
  private context: AudioContext | null = null;
  private channels = new Map<string, Channel>();
  private timer: number | null = null;
  private levelsListener: ((updates: LevelUpdate[]) => void) | null = null;
  private lastAudible = new Map<string, boolean>();
  private unlockHandler: (() => void) | null = null;

  get audioContext(): AudioContext | null {
    return this.context;
  }

  onLevels(listener: ((updates: LevelUpdate[]) => void) | null): void {
    this.levelsListener = listener;
  }

  /** Create (or reuse) the AudioContext. Must be called from a user gesture. */
  ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor({ latencyHint: 'interactive' });
      this.startMetering();
    }
    // Browsers start the context suspended until a gesture; remember one just
    // in case the join click happened before the first track arrived.
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
      this.installUnlockHandler();
    }
    return this.context;
  }

  private installUnlockHandler(): void {
    if (this.unlockHandler || typeof window === 'undefined') return;
    const handler = () => {
      void this.context?.resume().catch(() => undefined);
      if (this.context?.state === 'running') this.removeUnlockHandler();
    };
    this.unlockHandler = handler;
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
  }

  private removeUnlockHandler(): void {
    if (!this.unlockHandler) return;
    window.removeEventListener('pointerdown', this.unlockHandler);
    window.removeEventListener('keydown', this.unlockHandler);
    this.unlockHandler = null;
  }

  /** Route a remote audio MediaStreamTrack through its own gain + analyser. */
  addTrack(options: {
    key: string;
    identity: string;
    role: TrackRole;
    track: MediaStreamTrack;
    gain: number;
  }): void {
    const context = this.ensureContext();
    if (!context) return;
    this.removeChannel(options.key);

    try {
      const stream = new MediaStream([options.track]);
      const keepAlive = document.createElement('audio');
      keepAlive.muted = true;
      keepAlive.autoplay = true;
      keepAlive.dataset.mgAudioKeepAlive = '1';
      keepAlive.srcObject = stream;
      document.body.appendChild(keepAlive);
      void keepAlive.play().catch(() => undefined);
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      const gain = context.createGain();
      gain.gain.value = options.gain;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      this.channels.set(options.key, {
        key: options.key,
        identity: options.identity,
        role: options.role,
        source,
        analyser,
        gain,
        sink: null,
        keepAlive,
        buffer: new Float32Array(analyser.fftSize),
      });
    } catch {
      // Some browsers refuse a very short-lived stream; the next subscribe
      // attempt re-creates the channel.
    }
  }

  /**
   * Local microphone metering only — never routed to the speakers (that would
   * echo). A zero gain sink keeps the graph flowing so the analyser updates.
   */
  addLocalMeter(options: { key: string; identity: string; track: MediaStreamTrack }): void {
    const context = this.ensureContext();
    if (!context) return;
    this.removeChannel(options.key);
    try {
      const stream = new MediaStream([options.track]);
      const keepAlive = document.createElement('audio');
      keepAlive.muted = true;
      keepAlive.autoplay = true;
      keepAlive.dataset.mgAudioKeepAlive = '1';
      keepAlive.srcObject = stream;
      document.body.appendChild(keepAlive);
      void keepAlive.play().catch(() => undefined);
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const gain = context.createGain();
      gain.gain.value = 0;
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(sink);
      sink.connect(context.destination);
      this.channels.set(options.key, {
        key: options.key,
        identity: options.identity,
        role: 'mic',
        source,
        analyser,
        gain,
        sink,
        buffer: new Float32Array(analyser.fftSize),
      });
    } catch {
      // ignore
    }
  }

  removeChannel(key: string): void {
    const channel = this.channels.get(key);
    if (!channel) return;
    try {
      channel.source.disconnect();
    } catch {
      // already disconnected
    }
    try {
      channel.analyser.disconnect();
    } catch {
      // already disconnected
    }
    try {
      channel.gain.disconnect();
    } catch {
      // already disconnected
    }
    channel.sink?.disconnect();
    channel.keepAlive.remove();
    this.channels.delete(key);
    this.lastAudible.delete(key);
  }

  removeIdentity(identity: string): void {
    for (const [key, channel] of this.channels) {
      if (channel.identity === identity) this.removeChannel(key);
    }
  }

  /**
   * Drop every routed track but keep the AudioContext alive — used on
   * reconnects so speaking metering keeps working without a new gesture.
   */
  clearTracks(): void {
    for (const key of [...this.channels.keys()]) this.removeChannel(key);
    this.lastAudible.clear();
  }

  /** Recompute every gain from the store's current preferences. */
  applyGains(resolve: (identity: string, role: TrackRole) => number): void {
    for (const channel of this.channels.values()) {
      const target = Math.max(0, Math.min(2, resolve(channel.identity, channel.role)));
      // Local meter is intentionally silent.
      if (channel.sink) continue;
      try {
        channel.gain.gain.setTargetAtTime(target, this.context?.currentTime ?? 0, 0.015);
      } catch {
        channel.gain.gain.value = target;
      }
      if (this.context?.state === 'suspended' && target > 0) {
        void this.context.resume().catch(() => undefined);
      }
    }
  }

  private startMetering(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      if (!this.levelsListener) return;
      const updates: LevelUpdate[] = [];
      let changed = false;
      for (const channel of this.channels.values()) {
        channel.analyser.getFloatTimeDomainData(channel.buffer);
        let sum = 0;
        for (let i = 0; i < channel.buffer.length; i += 1) {
          sum += channel.buffer[i] * channel.buffer[i];
        }
        const rms = Math.sqrt(sum / channel.buffer.length);
        const audible = rms > SPEAKING_THRESHOLD;
        // Only real microphones drive the speaking ring; the radio bot and
        // screen-share audio never "speak".
        if (channel.role === 'mic' && channel.identity !== '') {
          updates.push({ identity: channel.identity, level: rms });
        }
        if (this.lastAudible.get(channel.identity) !== audible) {
          this.lastAudible.set(channel.identity, audible);
          changed = true;
        }
      }
      if (updates.length > 0 || changed) this.levelsListener(updates);
    }, LEVEL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeUnlockHandler();
    this.levelsListener = null;
    for (const key of [...this.channels.keys()]) this.removeChannel(key);
    this.lastAudible.clear();
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}

export const voiceAudioEngine = new VoiceAudioEngine();

// TEMP DEBUG: live audio-graph state for autoplay/subscription diagnosis.
if (typeof window !== 'undefined') {
  (window as unknown as { __mgAudioInfo: () => unknown }).__mgAudioInfo = () => {
    const engine = voiceAudioEngine as unknown as {
      context: { state?: string } | null;
      channels: Map<string, { key: string; role: string; gain: { gain: { value: number } } }>;
    };
    return {
      contextState: engine.context?.state ?? 'no-context',
      channels: [...engine.channels.values()].map((c) => ({
        key: c.key,
        role: c.role,
        gain: c.gain?.gain?.value,
      })),
    };
  };
}
export type { TrackRole };
