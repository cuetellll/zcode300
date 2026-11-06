import { useEffect, useState } from 'react';
import { CircleStop, Radio, Users, Volume2, VolumeX } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { emitSocket } from '../../lib/socket';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import type { RadioStateDto } from '../../lib/types';

/**
 * Mahyar Radio panel — shared per-voice-room playback.
 *
 * Play/stop are room-wide (the server relays to every listener and the radio
 * bot publishes into the LiveKit room). Volume + mute are LOCAL: the radio
 * track has its own GainNode (0–200%), independent from every user's voice,
 * and both values persist across reloads.
 */
export function RadioPanel({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const stations = useDataStore((s) => s.radioStations);
  const radioEnabled = useDataStore((s) => s.radioEnabled);
  const radioStates = useDataStore((s) => s.radioStates);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const radioVolume = useVoiceStore((s) => s.radioVolume);
  const radioMuted = useVoiceStore((s) => s.radioMuted);
  const setRadioVolume = useVoiceStore((s) => s.setRadioVolume);
  const toggleRadioMute = useVoiceStore((s) => s.toggleRadioMute);
  const pushToast = useUiStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const inVoice = voiceMode === 'voice' && voiceChannelId === channelId;
  const state: RadioStateDto | undefined = radioStates[channelId];
  const isLive = state?.status === 'live';
  const isStarting = state?.status === 'starting' || state?.status === 'stopping';
  const isError = state?.status === 'error';
  const disabled = !inVoice || !radioEnabled || busy;
  const effectiveVolume = radioMuted ? 0 : radioVolume;

  useEffect(() => {
    // Refresh snapshot when entering the room (socket push handles updates).
    void api(`/api/radio/state?channel_id=${encodeURIComponent(channelId)}`)
      .then((snap) => {
        useDataStore.setState((s) => ({ radioStates: { ...s.radioStates, [channelId]: snap as RadioStateDto } }));
      })
      .catch(() => undefined);
  }, [channelId]);

  async function play(stationId: string) {
    if (disabled) return;
    setBusy(true);
    emitSocket('radio:play', { channelId, stationId }, (result) => {
      const response = result as { ok: boolean; error?: string; code?: string };
      setBusy(false);
      if (!response.ok) {
        pushToast(
          response.code === 'NOT_IN_VOICE'
            ? t('joinVoiceFirst')
            : response.error ?? t('radioError'),
          'error',
        );
      }
    });
  }

  function stop() {
    if (!inVoice) return;
    emitSocket('radio:stop', { channelId }, (result) => {
      const response = result as { ok: boolean; error?: string };
      if (!response.ok) pushToast(response.error ?? t('radioError'), 'error');
    });
  }

  return (
    <section className="px-3 py-2" aria-label={t('mahyarRadio')}>
      <header className="mb-2 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded text-white"
          style={{ background: 'var(--brand-primary)' }}
        >
          <Radio size={13} />
        </span>
        <h2 className="text-[13px] font-bold">{t('mahyarRadio')}</h2>
        {isLive && <span className="live-badge">● LIVE</span>}
        {isLive && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={t('listeners')}>
            <Users size={12} /> {state?.listeners}
          </span>
        )}
        <div className="flex-1" />
        {isLive && (
          <button type="button" className="btn btn-sm btn-danger" onClick={stop} title={t('radioStop')}>
            <CircleStop size={13} /> {t('radioStop')}
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4">
          {stations.map((station) => {
            const active = isLive && state?.station_id === station.id;
            return (
              <button
                key={station.id}
                type="button"
                onClick={() => void play(station.id)}
                disabled={disabled || !radioEnabled}
                className="flex min-w-0 flex-col items-start rounded px-2 py-1.5 text-start transition-colors disabled:opacity-50"
                style={{
                  background: active ? 'rgba(88,101,242,0.18)' : 'var(--bg-rail)',
                  border: `1px solid ${active ? 'var(--brand-primary)' : 'transparent'}`,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                title={station.title}
              >
                <span className="flex w-full items-center gap-1 text-[13px] font-semibold">
                  <span className="min-w-0 flex-1 truncate">{station.title}</span>
                  {active && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--danger)' }} />}
                </span>
                <span className="w-full truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {station.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* local volume — independent from voice + persisted */}
        <div className="flex items-center gap-1.5" title={t('radioVolume')}>
          <button
            type="button"
            className={`icon-btn h-7 w-7 ${radioMuted ? 'is-danger' : ''}`}
            onClick={toggleRadioMute}
            aria-pressed={radioMuted}
            aria-label={radioMuted ? t('unmuteRadio') : t('muteRadio')}
            title={radioMuted ? t('unmuteRadio') : t('muteRadio')}
            data-tip={radioMuted ? t('unmuteRadio') : t('muteRadio')}
          >
            {radioMuted || effectiveVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            className="slider w-20"
            min={0}
            max={200}
            step={1}
            dir="ltr"
            value={Math.round(radioVolume * 100)}
            onChange={(event) => setRadioVolume(Number(event.target.value) / 100)}
            aria-label={t('radioVolume')}
          />
          <span className="w-8 text-end text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {Math.round(effectiveVolume * 100)}%
          </span>
        </div>
      </div>

      <div className="mt-1.5 flex min-h-5 items-center gap-2 text-[11px]">
        {!radioEnabled ? (
          <span style={{ color: 'var(--text-muted)' }}>{t('radioDisabled')}</span>
        ) : !inVoice ? (
          <span style={{ color: 'var(--text-muted)' }}>🎧 {t('joinVoiceFirst')}</span>
        ) : isError ? (
          <span style={{ color: 'var(--danger)' }}>
            ⚠ {state?.error ?? t('radioError')}{' '}
            {state?.station_id && (
              <button type="button" className="btn btn-link" onClick={() => void play(state.station_id!)}>
                {t('retry')}
              </button>
            )}
          </span>
        ) : isStarting ? (
          <span style={{ color: 'var(--status-idle)' }}>◌ {t('radioStarting')}</span>
        ) : isLive ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--brand-primary)' }}>{t('radioPlaying')}</strong> · {state?.station_title}
            {radioMuted && <span style={{ color: 'var(--text-muted)' }}> — {t('muteRadio')}</span>}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{t('radioHint')}</span>
        )}
      </div>
    </section>
  );
}
