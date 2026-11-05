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
import { emitSocket } from '../lib/socket';
import type { VoiceTokenResponse } from '../lib/types';

export interface VoiceParticipantView {
  identity: string;
  name: string;
  isRadioBot: boolean;
  speaking: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  joinedAt: number;
}

type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

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
  radioVolume: number;
  lastError: string | null;

  joinVoice: (channelId: string) => Promise<void>;
  joinDmCall: (conversationId: string) => Promise<void>;
  leave: (opts?: { silent?: boolean }) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setRadioVolume: (volume: number) => void;
  clearError: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;

/** Direct room access for video attachment in components. */
export function getLiveRoom(): Room | null {
  return room;
}

let room: Room | null = null;
let audioContainer: HTMLDivElement | null = null;
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;
let joiningToken: symbol | null = null;

function ensureAudioContainer(): HTMLDivElement {
  if (!audioContainer) {
    audioContainer = document.createElement('div');
    audioContainer.style.display = 'none';
    audioContainer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(audioContainer);
  }
  return audioContainer;
}

function describeMediaError(error: unknown): string {
  const name = (error as DOMException)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'device';
  return 'unknown';
}

export const useVoiceStore = create<VoiceState>((set, get) => {
  function snapshotParticipants(): void {
    if (!room) return;
    const remote: VoiceParticipantView[] = Object.values(room.remoteParticipants).map((participant) => ({
      identity: participant.identity,
      name: participant.name || participant.identity,
      isRadioBot: participant.identity.startsWith('mahyar-radio-'),
      speaking: participant.isSpeaking,
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
      speaking: local.isSpeaking,
      micMuted: !local.isMicrophoneEnabled,
      cameraOn: local.isCameraEnabled,
      screenOn: local.isScreenShareEnabled,
      joinedAt: 0,
    };
    const radioBots = remote.filter((p) => p.isRadioBot);
    const humans = remote.filter((p) => !p.isRadioBot);
    set({ participants: [localView, ...humans, ...radioBots] });
  }

  function isDeafened(): boolean {
    return get().deafened;
  }

  function attachRemoteTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind !== Track.Kind.Audio) return;
    const container = ensureAudioContainer();
    const element = track.attach();
    element.dataset.identity = participant.identity;
    container.appendChild(element);
    void element.play().catch(() => undefined);
    const remoteAudio = track as RemoteTrack & { setVolume?: (v: number) => void };
    if (typeof remoteAudio.setVolume === 'function') {
      const isRadio = participant.identity.startsWith('mahyar-radio-');
      remoteAudio.setVolume(isRadio ? get().radioVolume : isDeafened() ? 0 : 1);
    }
  }

  function detachRemoteTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind !== Track.Kind.Audio) return;
    track.detach().forEach((element) => element.remove());
    void participant;
    const container = audioContainer;
    if (container) {
      container.querySelectorAll(`[data-identity="${participant.identity}"]`).forEach((el) => el.remove());
    }
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

  function wireRoomEvents(targetRoom: Room, context: { channelId: string | null; conversationId: string | null }): void {
    targetRoom.on(RoomEvent.Connected, () => {
      set({ status: 'connected' });
      snapshotParticipants();
      if (context.channelId) emitSocket('voice:join', { channelId: context.channelId });
    });
    targetRoom.on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }));
    targetRoom.on(RoomEvent.Reconnected, () => {
      set({ status: 'connected' });
      if (context.channelId) emitSocket('voice:join', { channelId: context.channelId });
    });
    targetRoom.on(RoomEvent.Disconnected, () => {
      if (get().mode === 'idle') return;
      void attemptReconnect(context);
    });
    targetRoom.on(RoomEvent.ParticipantConnected, snapshotParticipants);
    targetRoom.on(RoomEvent.ParticipantDisconnected, snapshotParticipants);
    targetRoom.on(RoomEvent.ActiveSpeakersChanged, snapshotParticipants);
    targetRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      attachRemoteTrack(track, participant);
      snapshotParticipants();
    });
    targetRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      detachRemoteTrack(track, participant);
      snapshotParticipants();
    });
    targetRoom.on(RoomEvent.TrackMuted, snapshotParticipants);
    targetRoom.on(RoomEvent.TrackUnmuted, snapshotParticipants);
    targetRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.source === Track.Source.Camera) set({ cameraOn: true });
      if (publication.source === Track.Source.ScreenShare) set({ screenOn: true });
      if (publication.source === Track.Source.Microphone) set({ micEnabled: true });
      snapshotParticipants();
      syncLocalStateToServer();
    });
    targetRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.Camera) set({ cameraOn: false });
      if (publication.source === Track.Source.ScreenShare) set({ screenOn: false });
      if (publication.source === Track.Source.Microphone) set({ micEnabled: false });
      snapshotParticipants();
      syncLocalStateToServer();
    });
  }

  async function attemptReconnect(context: { channelId: string | null; conversationId: string | null }): Promise<void> {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      await cleanupRoom();
      set({ mode: 'idle', status: 'failed', lastError: 'Connection lost.' });
      return;
    }
    reconnectAttempts += 1;
    set({ status: 'reconnecting' });
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 30_000);
    reconnectTimer = window.setTimeout(async () => {
      try {
        const state = get();
        await cleanupRoom({ keepStore: true });
        if (context.channelId && state.mode === 'voice') {
          const token = await api<VoiceTokenResponse>('/api/voice/token', {
            method: 'POST',
            body: { channel_id: context.channelId },
          });
          const newRoom = createRoom();
          wireRoomEvents(newRoom, context);
          room = newRoom;
          await newRoom.connect(token.url, token.token);
        } else if (context.conversationId && state.mode === 'dm') {
          const token = await api<{ url: string; token: string }>('/api/voice/dm/call-token', {
            method: 'POST',
            body: { conversation_id: context.conversationId },
          });
          const newRoom = createRoom();
          wireRoomEvents(newRoom, context);
          room = newRoom;
          await newRoom.connect(token.url, token.token);
        }
        reconnectAttempts = 0;
      } catch {
        await attemptReconnect(context);
      }
    }, delay);
  }

  function createRoom(): Room {
    const options: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
    };
    return new Room(options);
  }

  async function cleanupRoom(opts: { keepStore?: boolean } = {}): Promise<void> {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (room) {
      try {
        await room.disconnect();
      } catch {
        // already disconnected
      }
      room = null;
    }
    if (audioContainer) audioContainer.innerHTML = '';
    reconnectAttempts = 0;
    if (!opts.keepStore) {
      set({ participants: [], micEnabled: false, cameraOn: false, screenOn: false });
    }
  }

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
    radioVolume: Number(localStorage.getItem('mahyar_gap_radio_volume') ?? 0.8),
    lastError: null,

    async joinVoice(channelId) {
      if (joiningToken) return;
      const myJoin = Symbol('join');
      joiningToken = myJoin;
      try {
        set({ mode: 'voice', channelId, conversationId: null, status: 'connecting', lastError: null });
        await cleanupRoom({ keepStore: true });
        const token = await api<VoiceTokenResponse>('/api/voice/token', {
          method: 'POST',
          body: { channel_id: channelId },
        });
        set({ canSpeak: token.permissions.can_speak, canStream: token.permissions.can_stream });
        const newRoom = createRoom();
        wireRoomEvents(newRoom, { channelId, conversationId: null });
        room = newRoom;
        await newRoom.connect(token.url, token.token);
        if (token.permissions.can_speak) {
          try {
            await newRoom.localParticipant.setMicrophoneEnabled(true);
          } catch (error) {
            if (describeMediaError(error) === 'permission') {
              set({ lastError: 'mic-permission' });
            }
          }
        } else {
          set({ micEnabled: false });
        }
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
        await cleanupRoom({ keepStore: true });
        const token = await api<{ url: string; token: string }>('/api/voice/dm/call-token', {
          method: 'POST',
          body: { conversation_id: conversationId },
        });
        const newRoom = createRoom();
        wireRoomEvents(newRoom, { channelId: null, conversationId });
        room = newRoom;
        await newRoom.connect(token.url, token.token);
        await newRoom.localParticipant.setMicrophoneEnabled(true).catch(() => set({ lastError: 'mic-permission' }));
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
      await cleanupRoom();
      set({ mode: 'idle', status: 'idle', channelId: null, conversationId: null, deafened: false });
      if (mode === 'voice' && channelId) {
        emitSocket('voice:leave', { channelId });
      }
      if (mode === 'dm' && conversationId) {
        emitSocket('dm:call_ended', { conversationId });
      }
    },

    async toggleMic() {
      if (!room) return;
      const next = !get().micEnabled;
      try {
        await room.localParticipant.setMicrophoneEnabled(next);
        set({ micEnabled: next });
        syncLocalStateToServer();
      } catch {
        set({ lastError: 'mic-permission' });
      }
    },

    async toggleDeafen() {
      if (!room) return;
      const next = !get().deafened;
      set({ deafened: next });
      for (const participant of Object.values(room.remoteParticipants)) {
        for (const publication of participant.audioTrackPublications) {
          const track = publication.audioTrack as (RemoteTrack & { setVolume?: (v: number) => void }) | undefined;
          if (track && typeof track.setVolume === 'function') {
            const isRadio = participant.identity.startsWith('mahyar-radio-');
            if (isRadio) {
              track.setVolume(next ? 0 : get().radioVolume);
            } else {
              track.setVolume(next ? 0 : 1);
            }
          }
        }
      }
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
      } catch (error) {
        if (describeMediaError(error) === 'permission') set({ lastError: 'camera-permission' });
      }
    },

    async toggleScreenShare() {
      if (!room) return;
      const next = !get().screenOn;
      try {
        await room.localParticipant.setScreenShareEnabled(next, { audio: true });
        set({ screenOn: next });
        syncLocalStateToServer();
      } catch {
        // User cancelled the picker or the browser refused — not an app error.
      }
    },

    setRadioVolume(volume) {
      set({ radioVolume: volume });
      localStorage.setItem('mahyar_gap_radio_volume', String(volume));
      if (!room) return;
      for (const participant of Object.values(room.remoteParticipants)) {
        if (!participant.identity.startsWith('mahyar-radio-')) continue;
        for (const publication of participant.audioTrackPublications) {
          const track = publication.audioTrack as (RemoteTrack & { setVolume?: (v: number) => void }) | undefined;
          if (track && typeof track.setVolume === 'function') {
            track.setVolume(get().deafened ? 0 : volume);
          }
        }
      }
    },

    clearError() {
      set({ lastError: null });
    },
  };
});
