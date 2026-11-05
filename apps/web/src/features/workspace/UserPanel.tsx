import { Headphones, HeadphoneOff, LogOut, Mic, MicOff, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/auth';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/ui';

export function UserPanel() {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const voice = useVoiceStore();

  useEffect(() => {
    if (!voice.lastError) return;
    pushToast(
      voice.lastError === 'mic-permission'
        ? t('micPermissionDenied')
        : voice.lastError === 'camera-permission'
          ? t('cameraPermissionDenied')
          : voice.lastError,
      'error',
    );
    voice.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.lastError]);

  if (!me) return null;

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // cookie may already be gone
    }
    voice.leave().catch(() => undefined);
    disconnectSocket();
    clear();
    window.location.assign('/app');
  }

  const inVoice = voice.mode !== 'idle';

  return (
    <div
      className="flex h-14 items-center gap-2 px-2"
      style={{ background: 'var(--bg-rail)', borderTop: '1px solid var(--border-subtle)' }}
    >
      <Avatar user={me} size={32} showStatus />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold">{me.display_name}</div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">
          {inVoice ? t('voiceConnected') : `@${me.username}`}
        </div>
      </div>
      <div className="flex items-center">
        {inVoice && (
          <>
            <button
              type="button"
              className="btn btn-ghost p-1.5"
              title={voice.micEnabled ? t('mute') : t('unmute')}
              onClick={() => void voice.toggleMic()}
              style={{ color: voice.micEnabled ? undefined : 'var(--danger)' }}
              aria-pressed={!voice.micEnabled}
            >
              {voice.micEnabled ? <Mic size={17} /> : <MicOff size={17} />}
            </button>
            <button
              type="button"
              className="btn btn-ghost p-1.5"
              title={voice.deafened ? t('undeafen') : t('deafen')}
              onClick={() => void voice.toggleDeafen()}
              style={{ color: voice.deafened ? 'var(--danger)' : undefined }}
              aria-pressed={voice.deafened}
            >
              {voice.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-ghost p-1.5"
          title={t('settings')}
          onClick={() => openModal('settings')}
          aria-label={t('settings')}
        >
          <Settings size={17} />
        </button>
        <button
          type="button"
          className="btn btn-ghost p-1.5"
          title={t('logout')}
          onClick={() => void logout()}
          aria-label={t('logout')}
        >
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}
