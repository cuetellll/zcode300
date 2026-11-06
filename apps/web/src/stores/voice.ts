import { create } from 'zustand';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type RoomOptions,
} from 'livekit-client';
import { api } from '../lib/api';
import { emitSocket, onConnect } from '../lib/socket';
import type { VoiceTokenResponse } from '../lib/types';
import { voiceAudioEngine, type LevelUpdate, type TrackRole } from '../features/voice/audio-engine';
import {
  MAX_USER_VOLUME,
  clampVolume,
  loadRadioMuted,
  loadRadioVolume,
  loadVoicePrefs,
  saveRadioMuted,
  saveRadioVolume,
  saveVoicePrefs,
  type VoicePrefs,
} from '../features/voice/prefs';

export interface VoiceParticipantView {
  identity: string;
  name: string;
  isRadioBot: boolean;
  speaking: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** True when this person is the active screen-share publisher we watch. */
  joinedAt: number;
}

type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ShareQuality {
  height: 720 | 1080;
  frameRate: 15 | 30 | 60;
}

interface VoiceState {
  mode: 'idle' | 'voice' | 'dm';
  channelId: string | null;
  conversationId: string | null;
  status: VoiceStatus;
  participants: VoiceParticipantView[];
  micEnabled: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  canSpeak: boolean;
  canStream: boolean;

  /** Local playback prefs (persisted, per browser). */
  userVolumes: Record<string, number>;
  mutedUsers: Record<string, boolean>;
  streamVolume: number;
  radioVolume: number;
  radioMuted: boolean;

  speaking: Record<string, boolean>;
  watching: string | null;
  shareQuality: ShareQuality;
  lastError: string | null;

  joinVoice: (channelId: string) => Promise<void>;
  joinDmCall: (conversationId: string) => Promise<void>;
  leave: (opts?: { silent?: boolean }) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: (options?: { quality?: ShareQuality }) => Promise<void>;
  setRadioVolume: (volume: number) => void;
  toggleRadioMute: () => void;
  setUserVolume: (identity: string, volume: number) => void;
  resetUserVolume: (identity: string) => void;
  toggleUserMute: (identity: string) => void;
  setStreamVolume: (volume: number) => void;
  setWatching: (identity: string | null) => void;
  setShareQuality: (quality: ShareQuality) => void;
  clearError: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const SPEAKING_THRESHOLD = 0.012;

const initialPrefs: VoicePrefs = loadVoicePrefs();

let room: Room | null = null;
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;
let joiningToken: symbol | null = null;
/** True while we are tearing the room down on purpose (leave / reconnect). */
let intentionalDisconnect = false;
let lastSpeakingSignature = '';

onConnect(() => {
  const state = useVoiceStore.getState();
  if (state.mode === 'voice' && state.channelId) {
    emitSocket('voice:join', { channelId: state.channelId });
  }
});

/** Direct room access for video attachment in components. */
export function getLiveRoom(): Room | null {
  return room;
}

function describeMediaError(error: unknown): string {
  const name = (error as DOMException)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'device';
  return 'unknown';
}

function isRadioIdentity(identity: string): boolean {
  return identity.startsWith('mahyar-radio-');
}

export const useVoiceStore = create<VoiceState>((set, get) => {
  function prefsSnapshot(): VoicePrefs {
    const state = get();
    return { volumes: state.userVolumes, muted: state.mutedUsers, streamVolume: state.streamVolume };
  }

  function persistPrefs(): void {
    saveVoicePrefs(prefsSnapshot());
  }

  /** Single source of truth for every GainNode value. */
  function resolveGain(identity: string, role: TrackRole): number {
    const state = get();
    if (state.deafened) return 0;
    if (role === 'radio') return state.radioMuted ? 0 : state.radioVolume;
    if (role === 'screen') return state.streamVolume;
    if (state.mutedUsers[identity]) return 0;
    return state.userVolumes[identity] ?? 1;
  }

  function refreshGains(): void {
    voiceAudioEngine.applyGains(resolveGain);
  }

  function snapshotParticipants(): void {
    if (!room) return;
    const speaking = get().speaking;
    const remote: VoiceParticipantView[] = Object.values(room.remoteParticipants).map((participant) => ({
      identity: participant.identity,
      name: participant.name || participant.identity,
      isRadioBot: isRadioIdentity(participant.identity),
      speaking: Boolean(speaking[participant.identity]),
      micMuted: !participant.isMicrophoneEnabled,
      cameraOn: participant.isCameraEnabled,
      screenOn: participant.isScreenShareEnabled,
      joinedAt: participant.joinedAt.getTime(),
    }));
    const local = room.localParticipant;
    const localView: VoiceParticipantView = {
      identity: local.identity,
      name: local.name || local.identity,
      isRadioBot: false,
      speaking: Boolean(speaking[local.identity]),
      micMuted: !local.isMicrophoneEnabled,
      cameraOn: local.isCameraEnabled,
      screenOn: local.isScreenShareEnabled,
      joinedAt: 0,
    };
    const radioBots = remote.filter((p) => p.isRadioBot);
    const humans = remote.filter((p) => !p.isRadioBot);
    const next = [localView, ...humans, ...radioBots];
    const watching = get().watching;
    const watchingStillLive = watching
      ? next.some((participant) => participant.identity === watching && participant.screenOn)
      : true;
    set({ participants: next, ...(watchingStillLive ? {} : { watching: null }) });
  }

  function syncLocalStateToServer(): void {
    const state = get();
    if (state.mode !== 'voice' || !state.channelId) return;
    emitSocket('voice:state', {
      channelId: state.channelId,
      muted: !state.micEnabled,
      deafened: state.deafened,
      videoEnabled: state.cameraOn,
      screenSharing: state.screenOn,
    });
  }

  function registerLocalMicMeter(): void {
    if (!room) return;
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (track?.mediaStreamTrack) {
      voiceAudioEngine.addLocalMeter({
        key: `local:${room.localParticipant.identity}:mic`,
        identity: room.localParticipant.identity,
        track: track.mediaStreamTrack,
      });
    }
  }

  function unregisterLocalMicMeter(): void {
    voiceAudioEngine.removeChannel(`local:${room?.localParticipant.identity ?? 'me'}:mic`);
  }

  function attachRemoteAudio(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (track.kind !== Track.Kind.Audio) return;
    const role: TrackRole =
      publication.source === Track.Source.ScreenShareAudio
        ? 'screen'
        : isRadioIdentity(participant.identity)
          ? 'radio'
          : 'mic';
    voiceAudioEngine.addTrack({
      key: `${participant.identity}:${publication.trackSid}`,
      identity: participant.identity,
      role,
      track: track.mediaStreamTrack,
      gain: resolveGain(participant.identity, role),
    });
  }

  function detachRemoteAudio(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    voiceAudioEngine.removeChannel(`${participant.identity}:${publication.trackSid}`);
  }

  function wireRoomEvents(targetRoom: Room, context: { channelId: string | null; conversationId: string | null }): void {
    targetRoom.on(RoomEvent.Connected, () => {
      set({ status: 'connected' });
      registerLocalMicMeter();
      refreshGains();
      snapshotParticipants();
      if (context.channelId) emitSocket('voice:join', { channelId: context.channelId });
    });
    targetRoom.on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }));
    targetRoom.on(RoomEvent.Reconnected, () => {
      set({ status: 'connected' });
      registerLocalMicMeter();
      refreshGains();
      snapshotParticipants();
      if (context.channelId) emitSocket('voice:join', { channelId: context.channelId });
    });
    targetRoom.on(RoomEvent.Disconnected, () => {
      if (intentionalDisconnect || get().mode === 'idle') return;
      void attemptReconnect(context);
    });
    targetRoom.on(RoomEvent.ParticipantConnected, snapshotParticipants);
    targetRoom.on(RoomEvent.ParticipantDisconnected, () => {
      snapshotParticipants();
    });
    targetRoom.on(RoomEvent.ActiveSpeakersChanged, snapshotParticipants);
    targetRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      attachRemoteAudio(track, publication, participant);
      snapshotParticipants();
    });
    targetRoom.on(RoomEvent.TrackUnsubscribed, (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      detachRemoteAudio(publication, participant);
      snapshotParticipants();
    });
    targetRoom.on(RoomEvent.TrackMuted, snapshotParticipants);
    targetRoom.on(RoomEvent.TrackUnmuted, snapshotParticipants);
    targetRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.source === Track.Source.Camera) set({ cameraOn: true });
      if (publication.source === Track.Source.ScreenShare) set({ screenOn: true });
      if (publication.source === Track.Source.Microphone) {
        set({ micEnabled: true });
        registerLocalMicMeter();
      }
      snapshotParticipants();
      syncLocalStateToServer();
    });
    targetRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.Camera) set({ cameraOn: false });
      if (publication.source === Track.Source.ScreenShare) {
        set({ screenOn: false, watching: get().watching === targetRoom.localParticipant.identity ? null : get().watching });
      }
      if (publication.source === Track.Source.Microphone) {
        set({ micEnabled: false });
        unregisterLocalMicMeter();
      }
      snapshotParticipants();
      syncLocalStateToServer();
    });
    // Screen-share publications also fire TrackPublished on the remote side; the
    // participant snapshot is what the UI reads for camera/screen badges.
    targetRoom.on(RoomEvent.TrackPublished, snapshotParticipants);
    targetRoom.on(RoomEvent.TrackUnpublished, snapshotParticipants);
  }

  function createRoom(): Room {
    const options: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
    return new Room(options);
  }

  async function connectTo(context: { channelId: string | null; conversationId: string | null }, token: { url: string; token: string }): Promise<void> {
    // dispose() clears the metering listener, so re-register on every (re)connect.
    voiceAudioEngine.onLevels(handleLevels);
    const newRoom = createRoom();
    wireRoomEvents(newRoom, context);
    room = newRoom;
    await newRoom.connect(token.url, token.token);
  }

  async function attemptReconnect(context: { channelId: string | null; conversationId: string | null }): Promise<void> {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      await cleanupRoom();
      set({ mode: 'idle', status: 'failed', lastError: 'Connection lost.' });
      return;
    }
    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    set({ status: 'reconnecting' });
    const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(async () => {
      reconnectTimer = null;
      try {
        const state = get();
        if (state.mode === 'idle') return;
        await cleanupRoom({ keepStore: true });
        if (state.mode === 'voice' && context.channelId) {
          const token = await api<VoiceTokenResponse>('/api/voice/token', {
            method: 'POST',
            body: { channel_id: context.channelId },
          });
          await connectTo(context, token);
        } else if (state.mode === 'dm' && context.conversationId) {
          const token = await api<{ url: string; token: string }>('/api/voice/dm/call-token', {
            method: 'POST',
            body: { conversation_id: context.conversationId },
          });
          await connectTo(context, token);
        } else {
          return;
        }
        reconnectAttempts = 0;
      } catch {
        // Keep the counter across failures (cleanupRoom no longer resets it).
        void attemptReconnect(context);
      }
    }, delay);
  }

  async function cleanupRoom(opts: { keepStore?: boolean } = {}): Promise<void> {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (room) {
      const previous = room;
      room = null;
      intentionalDisconnect = true;
      previous.removeAllListeners();
      try {
        await previous.disconnect();
      } catch {
        // already disconnected
      }
      intentionalDisconnect = false;
    }
    if (opts.keepStore) {
      // Reconnect path: keep the AudioContext (and its metering timer) alive.
      voiceAudioEngine.clearTracks();
    } else {
      voiceAudioEngine.dispose();
    }
    lastSpeakingSignature = '';
    if (!opts.keepStore) {
      set({
        participants: [],
        micEnabled: false,
        cameraOn: false,
        screenOn: false,
        speaking: {},
        watching: null,
      });
    }
  }

  // One metering loop drives the Discord-style speaking rings (AnalyserNode
  // RMS per microphone, so it matches what you actually hear — not a guess).
  function handleLevels(updates: LevelUpdate[]): void {
    if (!updates.length) return;
    const next: Record<string, boolean> = {};
    for (const update of updates) {
      if (update.level > SPEAKING_THRESHOLD) next[update.identity] = true;
    }
    const signature = Object.keys(next).sort().join('|');
    if (signature === lastSpeakingSignature) return;
    lastSpeakingSignature = signature;
    set({ speaking: next });
    snapshotParticipants();
  }
  voiceAudioEngine.onLevels(handleLevels);

  return {
    mode: 'idle',
    channelId: null,
    conversationId: null,
    status: 'idle',
    participants: [],
    micEnabled: false,
    deafened: false,
    cameraOn: false,
    screenOn: false,
    canSpeak: true,
    canStream: true,

    userVolumes: initialPrefs.volumes,
    mutedUsers: initialPrefs.muted,
    streamVolume: initialPrefs.streamVolume,
    radioVolume: loadRadioVolume(),
    radioMuted: loadRadioMuted(),

    speaking: {},
    watching: null,
    shareQuality: { height: 1080, frameRate: 30 },
    lastError: null,

    async joinVoice(channelId) {
      if (joiningToken) return;
      const myJoin = Symbol('join');
      joiningToken = myJoin;
      try {
        set({ mode: 'voice', channelId, conversationId: null, status: 'connecting', lastError: null });
        // A user gesture is required before the first audio node; do it here.
        voiceAudioEngine.ensureContext();
        await cleanupRoom({ keepStore: true });
        reconnectAttempts = 0;
        const token = await api<VoiceTokenResponse>('/api/voice/token', {
          method: 'POST',
          body: { channel_id: channelId },
        });
        set({ canSpeak: token.permissions.can_speak, canStream: token.permissions.can_stream });
        await connectTo({ channelId, conversationId: null }, token);
        if (token.permissions.can_speak) {
          try {
            await room?.localParticipant.setMicrophoneEnabled(true);
          } catch (error) {
            if (describeMediaError(error) === 'permission') set({ lastError: 'mic-permission' });
          }
        } else {
          set({ micEnabled: false });
        }
        refreshGains();
      } catch (error) {
        await cleanupRoom();
        set({ mode: 'idle', status: 'failed', lastError: (error as Error).message || 'join-failed' });
      } finally {
        if (joiningToken === myJoin) joiningToken = null;
      }
    },

    async joinDmCall(conversationId) {
      if (joiningToken) return;
      const myJoin = Symbol('join');
      joiningToken = myJoin;
      try {
        set({ mode: 'dm', conversationId, channelId: null, status: 'connecting', lastError: null });
        voiceAudioEngine.ensureContext();
        await cleanupRoom({ keepStore: true });
        reconnectAttempts = 0;
        const token = await api<{ url: string; token: string }>('/api/voice/dm/call-token', {
          method: 'POST',
          body: { conversation_id: conversationId },
        });
        await connectTo({ channelId: null, conversationId }, token);
        await room?.localParticipant.setMicrophoneEnabled(true).catch(() => set({ lastError: 'mic-permission' }));
        refreshGains();
      } catch (error) {
        await cleanupRoom();
        set({ mode: 'idle', status: 'failed', lastError: (error as Error).message || 'join-failed' });
      } finally {
        if (joiningToken === myJoin) joiningToken = null;
      }
    },

    async leave() {
      const mode = get().mode;
      const channelId = get().channelId;
      const conversationId = get().conversationId;
      reconnectAttempts = 0;
      await cleanupRoom();
      set({
        mode: 'idle',
        status: 'idle',
        channelId: null,
        conversationId: null,
        deafened: false,
        watching: null,
      });
      if (mode === 'voice' && channelId) emitSocket('voice:leave', { channelId });
      if (mode === 'dm' && conversationId) emitSocket('dm:call_ended', { conversationId });
    },

    async toggleMic() {
      if (!room) return;
      const next = !get().micEnabled;
      try {
        await room.localParticipant.setMicrophoneEnabled(next);
        set({ micEnabled: next });
        if (next) registerLocalMicMeter();
        else unregisterLocalMicMeter();
        syncLocalStateToServer();
        snapshotParticipants();
      } catch {
        set({ lastError: 'mic-permission' });
      }
    },

    async toggleDeafen() {
      const next = !get().deafened;
      set({ deafened: next });
      refreshGains();
      syncLocalStateToServer();
    },

    async toggleCamera() {
      if (!room) return;
      const next = !get().cameraOn;
      try {
        await room.localParticipant.setCameraEnabled(next, {
          resolution: VideoPresets.h720.resolution,
        });
        set({ cameraOn: next });
        syncLocalStateToServer();
        snapshotParticipants();
      } catch (error) {
        if (describeMediaError(error) === 'permission') set({ lastError: 'camera-permission' });
      }
    },

    async toggleScreenShare(options) {
      if (!room) return;
      const next = !get().screenOn;
      const quality = options?.quality ?? get().shareQuality;
      try {
        await room.localParticipant.setScreenShareEnabled(next, {
          audio: true,
          resolution: { width: quality.height === 720 ? 1280 : 1920, height: quality.height, frameRate: quality.frameRate },
          video: true,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          contentHint: 'detail',
        });
        set({ screenOn: next, ...(next ? { watching: room.localParticipant.identity } : { watching: null }) });
        syncLocalStateToServer();
        snapshotParticipants();
      } catch (error) {
        // Picker cancelled (NotAllowedError) or unsupported — never fatal.
        if (describeMediaError(error) === 'permission' && (error as Error).name !== 'NotAllowedError') {
          set({ lastError: 'screen-permission' });
        }
      }
    },

    setRadioVolume(volume) {
      const next = clampVolume(volume);
      set({ radioVolume: next, ...(next > 0 && get().radioMuted ? { radioMuted: false } : {}) });
      saveRadioVolume(next);
      if (next > 0 && get().radioMuted) {
        set({ radioMuted: false });
        saveRadioMuted(false);
      }
      refreshGains();
    },

    toggleRadioMute() {
      const next = !get().radioMuted;
      set({ radioMuted: next });
      saveRadioMuted(next);
      refreshGains();
    },

    setUserVolume(identity, volume) {
      const next = clampVolume(volume);
      set({ userVolumes: { ...get().userVolumes, [identity]: next } });
      persistPrefs();
      refreshGains();
      snapshotParticipants();
    },

    resetUserVolume(identity) {
      const volumes = { ...get().userVolumes };
      delete volumes[identity];
      set({ userVolumes: volumes });
      persistPrefs();
      refreshGains();
    },

    toggleUserMute(identity) {
      const muted = { ...get().mutedUsers };
      if (muted[identity]) delete muted[identity];
      else muted[identity] = true;
      set({ mutedUsers: muted });
      persistPrefs();
      refreshGains();
      snapshotParticipants();
    },

    setStreamVolume(volume) {
      const next = clampVolume(volume);
      set({ streamVolume: next });
      persistPrefs();
      refreshGains();
    },

    setWatching(identity) {
      set({ watching: identity });
    },

    setShareQuality(quality) {
      set({ shareQuality: quality });
    },

    clearError() {
      set({ lastError: null });
    },
  };
});

/** Max user volume (0–200%) re-exported for the UI. */
export { MAX_USER_VOLUME };
