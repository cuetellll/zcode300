import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, Headphones, UserRound, VolumeX } from 'lucide-react';
import { useI18n } from '../../i18n';
import { ContextMenu, VolumeSlider } from '../../components/ui';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';

export interface ParticipantMenuTarget {
  identity: string;
  name: string;
  x: number;
  y: number;
}

/**
 * Right-click (desktop) / long-press (touch) participant menu, like Discord's
 * user context menu — but scoped to what this client can actually do: local
 * playback volume (0–200%), "mute for me", and the profile.
 */
export function useParticipantMenu() {
  const [target, setTarget] = useState<ParticipantMenuTarget | null>(null);

  const open = useCallback((identity: string, name: string, point: { clientX: number; clientY: number }) => {
    setTarget({ identity, name, x: point.clientX, y: point.clientY });
  }, []);
  const close = useCallback(() => setTarget(null), []);

  return { target, open, close };
}

export function ParticipantContextMenu({
  target,
  onClose,
}: {
  target: ParticipantMenuTarget;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const openModal = useUiStore((s) => s.openModal);
  const volume = useVoiceStore((s) => s.userVolumes[target.identity] ?? 1);
  const muted = useVoiceStore((s) => s.mutedUsers[target.identity] ?? false);
  const radioVolume = useVoiceStore((s) => s.radioVolume);
  const radioMuted = useVoiceStore((s) => s.radioMuted);
  const setUserVolume = useVoiceStore((s) => s.setUserVolume);
  const resetUserVolume = useVoiceStore((s) => s.resetUserVolume);
  const toggleUserMute = useVoiceStore((s) => s.toggleUserMute);
  const setRadioVolume = useVoiceStore((s) => s.setRadioVolume);
  const toggleRadioMute = useVoiceStore((s) => s.toggleRadioMute);

  const isRadio = target.identity.startsWith('mahyar-radio-');

  if (isRadio) {
    return (
      <ContextMenu x={target.x} y={target.y} onClose={onClose}>
        <div className="menu-label">{t('mahyarRadio')}</div>
        <VolumeSlider
          value={radioMuted ? 0 : radioVolume}
          onChange={(value) => setRadioVolume(value)}
          label={t('radioVolume')}
        />
        <button type="button" className="menu-item" role="menuitemcheckbox" onClick={toggleRadioMute}>
          <span className="flex h-4 w-4 items-center justify-center">{radioMuted ? <Check size={14} /> : null}</span>
          <VolumeX size={14} />
          {radioMuted ? t('unmuteRadio') : t('muteRadio')}
        </button>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu x={target.x} y={target.y} onClose={onClose}>
      <div className="menu-label">{target.name}</div>
      <VolumeSlider
        value={muted ? 0 : volume}
        onChange={(value) => setUserVolume(target.identity, value)}
        label={t('userVolume')}
        onReset={() => resetUserVolume(target.identity)}
        resetLabel={t('resetVolume')}
      />
      <div className="menu-sep" />
      <button
        type="button"
        className="menu-item"
        role="menuitemcheckbox"
        aria-checked={muted}
        onClick={() => toggleUserMute(target.identity)}
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-[3px] border"
          style={{ borderColor: muted ? 'var(--brand-primary)' : 'var(--border-strong)', background: muted ? 'var(--brand-primary)' : 'transparent' }}
        >
          {muted ? <Check size={12} color="#fff" /> : null}
        </span>
        <VolumeX size={14} />
        {t('muteForMe')}
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          onClose();
          openModal('userProfile', target.identity);
        }}
      >
        <UserRound size={14} />
        {t('viewProfile')}
      </button>
      <div className="menu-sep" />
      <div className="flex items-center gap-2 px-2 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <Headphones size={12} />
        {t('listening')}
      </div>
    </ContextMenu>
  );
}

/**
 * Pointer helpers: desktop right-click and touch long-press both open the menu.
 * A long press is cancelled by movement/scroll, so lists still scroll naturally.
 */
export function useParticipantPointerHandlers(
  open: (identity: string, name: string, point: { clientX: number; clientY: number }) => void,
  identity: string,
  name: string,
) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  return {
    onContextMenu: (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      open(identity, name, { clientX: event.clientX, clientY: event.clientY });
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        open(identity, name, { clientX: event.clientX, clientY: event.clientY });
        timer.current = null;
      }, 450);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!origin.current) return;
      if (Math.abs(event.clientX - origin.current.x) > 8 || Math.abs(event.clientY - origin.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
  };
}
