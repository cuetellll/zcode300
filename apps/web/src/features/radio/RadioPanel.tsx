import { useEffect, useState } from 'react';
import { CircleStop, Radio, Users, Volume2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { emitSocket } from '../../lib/socket';
import { useDataStore } from '../../stores/data';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../../stores/voice';
import type { RadioStateDto } from '../../lib/types';

/**
 * Mahyar Radio panel — shared per-voice-room playback.
 * Play/stop are room-wide (server relays to every listener); the volume
 * slider is LOCAL to this client only.
 */
export function RadioPanel({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const stations = useDataStore((s) => s.radioStations);
  const radioEnabled = useDataStore((s) => s.radioEnabled);
  const radioStates = useDataStore((s) => s.radioStates);
  const voiceMode = useVoiceStore((s) => s.mode);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const deafened = useVoiceStore((s) => s.deafened);
  const radioVolume = useVoiceStore((s) => s.radioVolume);
  const setRadioVolume = useVoiceStore((s) => s.setRadioVolume);
  const pushToast = useUiStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const inVoice = voiceMode === 'voice' && voiceChannelId === channelId;
  const state: RadioStateDto | undefined = radioStates[channelId];
  const isLive = state?.status === 'live';
  const isStarting = state?.status === 'starting' || state?.status === 'stopping';
  const isError = state?.status === 'error';
  const disabled = !inVoice || !radioEnabled || busy;

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
            : response.code === 'RADIO_CAPACITY_FULL'
              ? response.error ?? t('radioError')
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
    <section className="p-4" aria-label={t('mahyarRadio')}>
      <header className="mb-3 flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
          style={{ background: 'var(--brand-gradient)' }}
        >
          <Radio size={16} />
        </span>
        <h2 className="text-sm font-bold">{t('mahyarRadio')}</h2>
        {isLive && <span className="live-badge">● LIVE</span>}
        <div className="flex-1" />
        {isLive && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]" title={t('listeners')}>
            <Users size={13} /> {state?.listeners}
          </span>
        )}
      </header>

      {!inVoice ? (
        <p className="rounded-[var(--radius)] px-3 py-3 text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
          🎧 {t('joinVoiceFirst')}
        </p>
      ) : !radioEnabled ? (
        <p className="rounded-[var(--radius)] px-3 py-3 text-xs" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
          {t('radioDisabled')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {stations.map((station) => {
              const active = isLive && state?.station_id === station.id;
              return (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => void play(station.id)}
                  disabled={disabled}
                  className="card flex flex-col items-start gap-0.5 p-3 text-start transition-all hover:border-[var(--brand-primary)] disabled:opacity-50"
                  style={
                    active
                      ? { borderColor: 'var(--brand-primary)', boxShadow: '0 0 14px var(--brand-glow)' }
                      : undefined
                  }
                >
                  <span className="flex w-full items-center gap-1 text-sm font-semibold">
                    <span className="min-w-0 flex-1 truncate">{station.title}</span>
                    {active && isLive && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--danger)' }} />}
                  </span>
                  <span className="w-full truncate text-[11px] text-[var(--text-muted)]">{station.description}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius)] px-3 py-2" style={{ background: 'var(--bg-input)' }}>
            <div className="min-w-0 flex-1 text-xs">
              {isError ? (
                <span style={{ color: 'var(--danger)' }}>
                  ⚠ {state?.error ?? t('radioError')}{' '}
                  {state?.station_id && (
                    <button type="button" className="underline" onClick={() => void play(state.station_id!)}>
                      {t('retry')}
                    </button>
                  )}
                </span>
              ) : isStarting ? (
                <span className="text-[var(--status-idle)]">◌ {t('radioStarting')}</span>
              ) : isLive ? (
                <span>
                  <strong style={{ color: 'var(--brand-accent)' }}>LIVE</strong> · {state?.station_title}
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">{t('radioHint')}</span>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]" title={t('volume')}>
              <Volume2 size={14} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={deafened ? 0 : radioVolume}
                onChange={(e) => setRadioVolume(Number(e.target.value))}
                className="w-28"
                aria-label={t('volume')}
              />
            </label>

            {(isLive || isStarting) && (
              <button type="button" className="btn btn-secondary text-xs" onClick={stop}>
                <CircleStop size={14} /> {t('radioStop')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
