import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ChevronDown,
  Expand,
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  MonitorPlay,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Volume2,
  X,
} from 'lucide-react';
import { Track } from 'livekit-client';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useVoiceStore, getLiveRoom, type ShareQuality, type VoiceParticipantView } from '../../stores/voice';
import { Avatar } from '../../components/ui';
import { resolveParticipantUser } from './participant-utils';
import type { ChannelDto, MemberDto } from '../../lib/types';

/** Attaches a LiveKit video track to a <video> element. Audio is muted: it is
 * routed separately through the Web Audio engine (stream volume). */
function useAttachedVideo(identity: string, source: 'camera' | 'screen', active: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  const participants = useVoiceStore((s) => s.participants);

  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const room = getLiveRoom();
    if (!room) return;
    const trackSource = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    const publication =
      identity === room.localParticipant.identity
        ? room.localParticipant.getTrackPublication(trackSource)
        : Object.values(room.remoteParticipants)
            .find((participant) => participant.identity === identity)
            ?.getTrackPublication(trackSource);
    const track = publication?.videoTrack;
    if (!track?.mediaStreamTrack) return;
    element.srcObject = new MediaStream([track.mediaStreamTrack]);
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [identity, source, active, participants]);

  return ref;
}

function ParticipantTile({
  participant,
  members,
  compact,
  onSelect,
}: {
  participant: VoiceParticipantView;
  members: MemberDto[];
  compact?: boolean;
  onSelect?: (participant: VoiceParticipantView) => void;
}) {
  const user = resolveParticipantUser(participant.identity, participant.name, members);
  const videoRef = useAttachedVideo(participant.identity, 'camera', participant.cameraOn);
  const size = compact ? 26 : 56;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onSelect?.(participant)}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        title={participant.name}
      >
        <Avatar user={user} size={size} speaking={participant.speaking} />
        <span className="max-w-24 truncate">{user.display_name}</span>
        {participant.micMuted && <MicOff size={11} style={{ color: 'var(--danger)' }} />}
      </button>
    );
  }

  return (
    <div
      className="relative aspect-video w-full max-w-[280px] flex-1 overflow-hidden rounded-[var(--radius-lg)]"
      style={{
        background: 'var(--bg-rail)',
        minWidth: 180,
        boxShadow: participant.speaking ? '0 0 0 2px var(--status-online)' : '0 0 0 1px var(--border-subtle)',
        transition: 'box-shadow 120ms ease',
      }}
    >
      {participant.cameraOn ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: participant.identity === useAuthStore.getState().user?.id ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <Avatar user={user} size={size} speaking={participant.speaking} />
          <span className="max-w-[90%] truncate px-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {user.display_name}
          </span>
        </div>
      )}
      <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1">
        <span
          className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
        >
          {participant.micMuted ? <MicOff size={11} /> : <Mic size={11} />}
          <span className="truncate">{user.display_name}</span>
          {participant.isRadioBot && <span className="live-badge ms-1" style={{ background: 'var(--brand-primary)' }}>RADIO</span>}
        </span>
      </div>
    </div>
  );
}

function StreamCard({
  participant,
  members,
  onWatch,
}: {
  participant: VoiceParticipantView;
  members: MemberDto[];
  onWatch: () => void;
}) {
  const { t } = useI18n();
  const user = resolveParticipantUser(participant.identity, participant.name, members);
  const previewRef = useAttachedVideo(participant.identity, 'screen', participant.screenOn);

  return (
    <div
      className="group relative flex w-full max-w-[520px] cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)]"
      style={{ background: 'var(--bg-rail)', boxShadow: '0 0 0 1px var(--border-subtle)' }}
      onClick={onWatch}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onWatch();
      }}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        <video ref={previewRef} autoPlay playsInline muted className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-90" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white transition-transform group-hover:scale-105"
            style={{ background: 'rgba(0,0,0,0.6)' }}
          >
            <MonitorPlay size={16} /> {t('watchStream')}
          </span>
        </div>
        <span className="live-badge absolute start-2 top-2">● LIVE</span>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Avatar user={user} size={22} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{user.display_name}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('screenSharingNow')}
        </span>
      </div>
    </div>
  );
}

function StreamView({ participant, members }: { participant: VoiceParticipantView; members: MemberDto[] }) {
  const { t } = useI18n();
  const videoRef = useAttachedVideo(participant.identity, 'screen', true);
  const streamVolume = useVoiceStore((s) => s.streamVolume);
  const setStreamVolume = useVoiceStore((s) => s.setStreamVolume);
  const setWatching = useVoiceStore((s) => s.setWatching);
  const participants = useVoiceStore((s) => s.participants);
  const user = resolveParticipantUser(participant.identity, participant.name, members);

  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [bumpControls]);

  async function toggleFullscreen() {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      // fullscreen may be blocked by the browser/iframe policy
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={containerRef}
        className="group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-lg)]"
        style={{ background: '#000' }}
        onMouseMove={bumpControls}
        onMouseLeave={() => setControlsVisible(false)}
        onDoubleClick={() => void toggleFullscreen()}
        onClick={bumpControls}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
          title={`${user.display_name} — ${t('screenSharingNow')}`}
        />

        {/* top bar */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-3 transition-opacity duration-150"
          style={{ opacity: controlsVisible ? 1 : 0, background: 'linear-gradient(rgba(0,0,0,0.65), transparent)' }}
        >
          <span className="live-badge">● LIVE</span>
          <Avatar user={user} size={22} />
          <span className="truncate text-sm font-semibold text-white">{user.display_name}</span>
          <div className="flex-1" />
        </div>

        {/* hover controls */}
        <div
          className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 p-3 transition-opacity duration-150"
          style={{
            opacity: controlsVisible ? 1 : 0,
            pointerEvents: controlsVisible ? 'auto' : 'none',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
          }}
        >
          <button
            type="button"
            className="icon-btn"
            style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
            onClick={() => void toggleFullscreen()}
            title={t('fullscreen')}
            aria-label={t('fullscreen')}
            data-tip={t('fullscreen')}
          >
            <Maximize2 size={16} />
          </button>
          <div className="flex min-w-0 items-center gap-2 rounded px-2 py-1" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <Volume2 size={14} color="#fff" />
            <input
              className="slider w-24"
              type="range"
              min={0}
              max={200}
              step={1}
              dir="ltr"
              value={Math.round(streamVolume * 100)}
              onChange={(event) => setStreamVolume(Number(event.target.value) / 100)}
              aria-label={t('streamVolume')}
            />
            <span className="w-8 text-end text-[11px] tabular-nums text-white">{Math.round(streamVolume * 100)}%</span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setWatching(null)}
            title={t('stopWatching')}
          >
            <X size={14} /> {t('stopWatching')}
          </button>
        </div>
      </div>

      {/* mini stage: who is in the call */}
      <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5">
        {participants.map((entry) => (
          <ParticipantTile key={entry.identity} participant={entry} members={members} compact />
        ))}
      </div>
    </div>
  );
}

function ControlBar({ channel }: { channel: ChannelDto }) {
  const { t } = useI18n();
  const status = useVoiceStore((s) => s.status);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const deafened = useVoiceStore((s) => s.deafened);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const canSpeak = useVoiceStore((s) => s.canSpeak);
  const canStream = useVoiceStore((s) => s.canStream);
  const shareQuality = useVoiceStore((s) => s.shareQuality);
  const setShareQuality = useVoiceStore((s) => s.setShareQuality);
  const leave = useVoiceStore((s) => s.leave);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const [qualityOpen, setQualityOpen] = useState(false);

  const connected = status === 'connected';

  return (
    <div
      className="relative flex shrink-0 items-center justify-center gap-1.5 border-t px-3 py-2.5"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span
        className="absolute start-3 hidden items-center gap-1.5 text-xs sm:flex"
        style={{ color: connected ? 'var(--status-online)' : 'var(--status-idle)' }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: connected ? 'var(--status-online)' : 'var(--status-idle)' }} />
        {connected ? `#${channel.name}` : status === 'reconnecting' ? t('reconnecting') : t('connecting')}
      </span>

      <button
        type="button"
        className={`icon-btn ${micEnabled ? '' : 'is-danger'}`}
        onClick={() => void toggleMic()}
        disabled={!canSpeak}
        title={micEnabled ? t('mute') : t('unmute')}
        aria-label={micEnabled ? t('mute') : t('unmute')}
        aria-pressed={!micEnabled}
        data-tip={micEnabled ? t('mute') : t('unmute')}
      >
        {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
      </button>

      <button
        type="button"
        className={`icon-btn ${deafened ? 'is-danger' : ''}`}
        onClick={() => void toggleDeafen()}
        title={deafened ? t('undeafen') : t('deafen')}
        aria-label={deafened ? t('undeafen') : t('deafen')}
        aria-pressed={deafened}
        data-tip={deafened ? t('undeafen') : t('deafen')}
      >
        {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </button>

      <button
        type="button"
        className={`icon-btn ${cameraOn ? 'is-brand' : ''}`}
        onClick={() => void toggleCamera()}
        disabled={!canStream}
        title={t('camera')}
        aria-label={t('camera')}
        aria-pressed={cameraOn}
        data-tip={t('camera')}
      >
        {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
      </button>

      <div className="relative">
        <button
          type="button"
          className={`icon-btn ${screenOn ? 'is-brand' : ''}`}
          onClick={() => {
            if (screenOn) void toggleScreenShare();
            else setQualityOpen((open) => !open);
          }}
          disabled={!canStream}
          title={t('screenShare')}
          aria-label={t('screenShare')}
          aria-pressed={screenOn}
          data-tip={t('screenShare')}
        >
          {screenOn ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>

        {qualityOpen && !screenOn && (
          <div
            className="menu animate-scale-in absolute bottom-full start-1/2 z-30 mb-2 w-64 -translate-x-1/2 p-3"
            style={{ color: 'var(--text-primary)' }}
            role="dialog"
            aria-label={t('shareQuality')}
          >
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-sm">{t('shareQuality')}</strong>
              <button type="button" className="icon-btn h-6 w-6" onClick={() => setQualityOpen(false)} aria-label={t('close')}>
                <X size={14} />
              </button>
            </div>
            <div className="mb-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('shareQualityHint')}
            </div>
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                {t('quality')}
              </div>
              <div className="flex gap-1">
                {([720, 1080] as const).map((height) => (
                  <button
                    key={height}
                    type="button"
                    className="btn btn-sm flex-1"
                    style={{ background: shareQuality.height === height ? 'var(--brand-primary)' : 'var(--bg-elevated)', color: '#fff' }}
                    onClick={() => setShareQuality({ ...shareQuality, height } as ShareQuality)}
                  >
                    {height}p
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                {t('frameRate')}
              </div>
              <div className="flex gap-1">
                {([15, 30, 60] as const).map((frameRate) => (
                  <button
                    key={frameRate}
                    type="button"
                    className="btn btn-sm flex-1"
                    style={{ background: shareQuality.frameRate === frameRate ? 'var(--brand-primary)' : 'var(--bg-elevated)', color: '#fff' }}
                    onClick={() => setShareQuality({ ...shareQuality, frameRate })}
                  >
                    {frameRate}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => {
                setQualityOpen(false);
                void toggleScreenShare({ quality: shareQuality });
              }}
            >
              <Expand size={14} /> {t('startShare')}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="icon-btn is-danger ms-2"
        onClick={() => void leave()}
        title={t('leaveVoice')}
        aria-label={t('leaveVoice')}
        data-tip={t('leaveVoice')}
      >
        <PhoneOff size={18} />
      </button>

      {!canSpeak && (
        <span className="absolute end-3 hidden text-[11px] sm:block" style={{ color: 'var(--text-muted)' }}>
          <ChevronDown size={11} className="inline" /> listener
        </span>
      )}
    </div>
  );
}

export function VoiceStage({ channel }: { channel: ChannelDto }) {
  const { t } = useI18n();
  const participants = useVoiceStore((s) => s.participants);
  const watching = useVoiceStore((s) => s.watching);
  const setWatching = useVoiceStore((s) => s.setWatching);
  const membersMap = useDataStore((s) => s.membersByServer);
  const members = membersMap[channel.server_id] ?? [];

  const screenSharers = participants.filter((participant) => participant.screenOn);
  const watched = watching ? participants.find((participant) => participant.identity === watching && participant.screenOn) : null;
  const cameraPeople = participants.filter((participant) => participant.cameraOn && !participant.screenOn);
  const audioOnly = participants.filter((participant) => !participant.cameraOn && !participant.screenOn);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {watched ? (
          <StreamView participant={watched} members={members} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-wrap content-start items-start justify-center gap-3 overflow-y-auto">
            {screenSharers.length === 0 && cameraPeople.length === 0 && audioOnly.length === 0 && (
              <p className="mt-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('connecting')}
              </p>
            )}

            {screenSharers.map((participant) => (
              <StreamCard
                key={`stream-${participant.identity}`}
                participant={participant}
                members={members}
                onWatch={() => setWatching(participant.identity)}
              />
            ))}

            {cameraPeople.map((participant) => (
              <ParticipantTile key={`cam-${participant.identity}`} participant={participant} members={members} />
            ))}

            {audioOnly.length > 0 && (
              <div className="flex w-full flex-wrap items-center justify-center gap-2 pt-1">
                {audioOnly.map((participant) => (
                  <ParticipantTile key={`audio-${participant.identity}`} participant={participant} members={members} compact />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <ControlBar channel={channel} />
    </div>
  );
}
