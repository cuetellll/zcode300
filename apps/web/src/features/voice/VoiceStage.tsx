import { useEffect, useRef } from 'react';
import {
  Camera,
  CameraOff,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
} from 'lucide-react';
import { Track } from 'livekit-client';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useVoiceStore } from '../../stores/voice';
import { getLiveRoom } from '../../stores/voice';
import { Avatar } from '../../components/ui';
import type { ChannelDto } from '../../lib/types';

/** Attaches (or detaches) a participant video track to a <video> element. */
function VideoTile({
  identity,
  source,
  mirrored,
}: {
  identity: string;
  source: 'camera' | 'screen';
  mirrored?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const room = getLiveRoom();
    if (!room) return;
    const trackSource = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    let videoTrack;
    if (identity === room.localParticipant.identity) {
      videoTrack = room.localParticipant.getTrackPublication(trackSource)?.videoTrack;
    } else {
      const participant = Object.values(room.remoteParticipants).find((p) => p.identity === identity);
      videoTrack = participant?.getTrackPublication(trackSource)?.videoTrack;
    }
    if (videoTrack) {
      element.srcObject = new MediaStream([videoTrack.mediaStreamTrack]);
    }
    void element.play().catch(() => undefined);

    return () => {
      element.srcObject = null;
    };
  }, [identity, source]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="h-full w-full object-cover"
      style={{ transform: mirrored && source === 'camera' ? 'scaleX(-1)' : undefined }}
    />
  );
}

export function VoiceStage({ channel }: { channel: ChannelDto }) {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const status = useVoiceStore((s) => s.status);
  const participants = useVoiceStore((s) => s.participants);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const deafened = useVoiceStore((s) => s.deafened);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const canSpeak = useVoiceStore((s) => s.canSpeak);
  const canStream = useVoiceStore((s) => s.canStream);
  const leave = useVoiceStore((s) => s.leave);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);

  // Screen sharers get the big tile; camera tiles fill the rest.
  const screenSharers = participants.filter((p) => p.screenOn);
  const cameraPeople = participants.filter((p) => !p.screenOn);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-wrap items-center justify-center gap-3 overflow-y-auto p-4">
        {screenSharers.length > 0 && (
          <div
            className="relative w-full flex-1 basis-full overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--border-strong)', minHeight: 260 }}
          >
            {screenSharers.map((participant) => (
              <VideoTile key={`screen-${participant.identity}`} identity={participant.identity} source="screen" />
            ))}
            <span className="absolute bottom-2 start-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
              🖥 {screenSharers.map((p) => p.name).join(', ')}
            </span>
          </div>
        )}
        {cameraPeople.map((participant) => (
          <div
            key={participant.identity}
            className="relative flex aspect-video w-56 items-center justify-center overflow-hidden rounded-xl border"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--bg-elevated)',
              boxShadow: participant.speaking ? '0 0 0 2px var(--status-online), 0 0 16px rgba(45,212,167,0.35)' : undefined,
            }}
          >
            {participant.cameraOn ? (
              <VideoTile identity={participant.identity} source="camera" mirrored={participant.identity === me?.id} />
            ) : (
              <Avatar
                user={{
                  id: participant.identity,
                  username: participant.name,
                  display_name: participant.name,
                  avatar_url: null,
                  avatar_color: '#5865F2',
                  banner_color: '#1e1f22',
                  status: 'ONLINE',
                  custom_status: null,
                  bio: null,
                  created_at: '',
                }}
                size={56}
              />
            )}
            <span className="absolute bottom-1.5 start-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
              {participant.micMuted ? <MicOff size={11} /> : null}
              {participant.isRadioBot ? '📻 ' : ''}
              {participant.isRadioBot ? 'Mahyar Radio' : participant.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="me-2 text-xs" style={{ color: status === 'connected' ? 'var(--status-online)' : 'var(--status-idle)' }}>
          {status === 'connected'
            ? `● ${t('voiceConnected')} — #${channel.name}`
            : status === 'reconnecting'
              ? t('reconnecting')
              : t('connecting')}
        </span>

        <button
          type="button"
          className="btn p-2.5"
          onClick={() => void toggleMic()}
          disabled={!canSpeak}
          title={micEnabled ? t('mute') : t('unmute')}
          aria-pressed={!micEnabled}
          style={{
            background: micEnabled ? 'var(--bg-elevated)' : 'var(--danger)',
            color: micEnabled ? 'var(--text-primary)' : '#fff',
          }}
        >
          {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>

        <button
          type="button"
          className="btn p-2.5"
          onClick={() => void toggleDeafen()}
          title={deafened ? t('undeafen') : t('deafen')}
          aria-pressed={deafened}
          style={{
            background: deafened ? 'var(--danger)' : 'var(--bg-elevated)',
            color: deafened ? '#fff' : 'var(--text-primary)',
          }}
        >
          {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </button>

        <button
          type="button"
          className="btn p-2.5"
          onClick={() => void toggleCamera()}
          disabled={!canStream}
          title={t('camera')}
          aria-pressed={cameraOn}
          style={{
            background: cameraOn ? 'var(--brand-primary)' : 'var(--bg-elevated)',
            color: cameraOn ? '#fff' : 'var(--text-primary)',
          }}
        >
          {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
        </button>

        <button
          type="button"
          className="btn p-2.5"
          onClick={() => void toggleScreenShare()}
          disabled={!canStream}
          title={t('screenShare')}
          aria-pressed={screenOn}
          style={{
            background: screenOn ? 'var(--brand-primary)' : 'var(--bg-elevated)',
            color: screenOn ? '#fff' : 'var(--text-primary)',
          }}
        >
          {screenOn ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>

        <button
          type="button"
          className="btn btn-danger p-2.5"
          onClick={() => void leave()}
          title={t('leaveVoice')}
        >
          <PhoneOff size={18} />
        </button>

        {!canSpeak && (
          <span className="ms-2 text-xs text-[var(--text-muted)]">
            <MonitorUp size={12} className="inline" /> listener mode
          </span>
        )}
      </div>
    </div>
  );
}
