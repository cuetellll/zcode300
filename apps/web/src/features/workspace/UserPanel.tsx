import { Headphones, HeadphoneOff, LogOut, Mic, MicOff, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/auth';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/ui';

/**
 * Bottom-left user panel (Discord's "self" bar): avatar, name, mic / deafen /
 * settings. Voice connection status lives directly above it in
 * VoiceConnectionPanel, so leaving a call is always one click away.
 */
export function UserPanel() {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const openModal = useUiStore((s) => s.openModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const deafened = useVoiceStore((s) => s.deafened);
  const mode = useVoiceStore((s) => s.mode);
  const lastError = useVoiceStore((s) => s.lastError);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const clearError = useVoiceStore((s) => s.clearError);
  const leave = useVoiceStore((s) => s.leave);

  useEffect(() => {
    if (!lastError) return;
    pushToast(
      lastError === 'mic-permission'
        ? t('micPermissionDenied')
        : lastError === 'camera-permission'
          ? t('cameraPermissionDenied')
          : lastError,
      'error',
    );
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastError]);

  if (!me) return null;

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // cookie may already be gone
    }
    void leave().catch(() => undefined);
    disconnectSocket();
    clear();
    window.location.assign('/app');
  }

  const inVoice = mode !== 'idle';

  return (
    <div
      className="flex h-[52px] shrink-0 items-center gap-1 px-1.5"
      style={{ background: 'var(--bg-rail)' }}
    >
      <button
        type="button"
        onClick={() => openModal('userProfile', me.id)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-start transition-colors hover:bg-[var(--bg-elevated)]"
        title={`${me.display_name} — @${me.username}`}
      >
        <Avatar user={me} size={32} showStatus />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold">{me.display_name}</span>
          <span className="block truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {inVoice ? t('inVoice') : `@${me.username}`}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className={`icon-btn h-8 w-8 ${inVoice && !micEnabled ? 'is-danger' : ''}`}
          onClick={() => void toggleMic()}
          disabled={!inVoice}
          title={micEnabled ? t('mute') : t('unmute')}
          aria-label={micEnabled ? t('mute') : t('unmute')}
          aria-pressed={!micEnabled}
          data-tip={micEnabled ? t('mute') : t('unmute')}
        >
          {micEnabled ? <Mic size={17} /> : <MicOff size={17} />}
        </button>
        <button
          type="button"
          className={`icon-btn h-8 w-8 ${deafened ? 'is-danger' : ''}`}
          onClick={() => void toggleDeafen()}
          disabled={!inVoice}
          title={deafened ? t('undeafen') : t('deafen')}
          aria-label={deafened ? t('undeafen') : t('deafen')}
          aria-pressed={deafened}
          data-tip={deafened ? t('undeafen') : t('deafen')}
        >
          {deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
        </button>
        <button
          type="button"
          className="icon-btn h-8 w-8"
          onClick={() => openModal('settings')}
          title={t('settings')}
          aria-label={t('settings')}
          data-tip={t('settings')}
        >
          <Settings size={17} />
        </button>
        <button
          type="button"
          className="icon-btn h-8 w-8"
          onClick={() => void logout()}
          title={t('logout')}
          aria-label={t('logout')}
          data-tip={t('logout')}
        >
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}
