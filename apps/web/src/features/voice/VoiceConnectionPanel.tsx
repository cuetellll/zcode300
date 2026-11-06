import { HeadphoneOff, PhoneOff, Signal, WifiOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { useVoiceStore } from '../../stores/voice';

/**
 * Discord's "Voice Connected" card, pinned above the user panel. It is the
 * one-click way out of a call from anywhere in the app.
 */
export function VoiceConnectionPanel() {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const mode = useVoiceStore((s) => s.mode);
  const channelId = useVoiceStore((s) => s.channelId);
  const conversationId = useVoiceStore((s) => s.conversationId);
  const status = useVoiceStore((s) => s.status);
  const deafened = useVoiceStore((s) => s.deafened);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const leave = useVoiceStore((s) => s.leave);
  const servers = useDataStore((s) => s.servers);
  const conversations = useDataStore((s) => s.conversations);

  if (mode === 'idle') return null;

  let title = t('voiceConnected');
  let subtitle = t('connecting');
  if (mode === 'voice') {
    const channel = servers.flatMap((server) => server.channels ?? []).find((entry) => entry.id === channelId);
    subtitle = channel ? channel.name : t('voiceChannel');
  } else {
    const conversation = conversations.find((entry) => entry.conversation_id === conversationId);
    const others = (conversation?.participants ?? []).filter((participant) => participant.id !== me?.id);
    subtitle = conversation?.is_group
      ? conversation?.group_name ?? others.map((other) => other.display_name).join(', ')
      : others[0]?.display_name ?? t('directMessages');
  }

  const connected = status === 'connected';
  const degraded = status === 'reconnecting' || status === 'connecting' || status === 'failed';
  if (degraded) title = status === 'failed' ? t('connectionLost') : t('reconnecting');

  return (
    <div
      className="mx-2 mb-1 overflow-hidden rounded-[var(--radius)]"
      style={{ background: 'var(--bg-elevated)' }}
    >
      <div className="flex items-center gap-2 px-2 pt-2 text-xs font-semibold">
        {connected ? (
          <Signal size={14} style={{ color: 'var(--status-online)' }} />
        ) : (
          <WifiOff size={14} style={{ color: 'var(--status-idle)' }} />
        )}
        <span style={{ color: connected ? 'var(--status-online)' : 'var(--status-idle)' }}>{title}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="icon-btn h-6 w-6"
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => void leave()}
          title={t('leaveVoice')}
          aria-label={t('leaveVoice')}
          data-tip={t('leaveVoice')}
        >
          <PhoneOff size={14} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <span className="truncate">🔊 {subtitle}</span>
        {deafened && <HeadphoneOff size={12} style={{ color: 'var(--danger)' }} />}
        {screenOn && (
          <span className="live-badge ms-auto" style={{ background: 'var(--status-online)' }}>
            LIVE
          </span>
        )}
      </div>
    </div>
  );
}
