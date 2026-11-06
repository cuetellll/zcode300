/**
 * Voice / radio local preferences.
 *
 * Everything here is per-browser and survives refresh + re-login:
 *   - per-user playback volume (0–200%) and "mute for me"
 *   - screen-share audio volume
 *   - radio volume + mute (kept in its own keys, independent of voice)
 */

const PREFS_KEY = 'mahyar_gap_voice_prefs_v2';
const RADIO_VOLUME_KEY = 'mahyar_gap_radio_volume';
const RADIO_MUTED_KEY = 'mahyar_gap_radio_muted';

export const MAX_USER_VOLUME = 2;

export interface VoicePrefs {
  volumes: Record<string, number>;
  muted: Record<string, boolean>;
  streamVolume: number;
}

const DEFAULT_PREFS: VoicePrefs = { volumes: {}, muted: {}, streamVolume: 1 };

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(MAX_USER_VOLUME, value));
}

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS, volumes: {}, muted: {} };
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    const volumes: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed.volumes ?? {})) {
      if (typeof value === 'number') volumes[id] = clampVolume(value);
    }
    const muted: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed.muted ?? {})) {
      if (value === true) muted[id] = true;
    }
    return {
      volumes,
      muted,
      streamVolume: typeof parsed.streamVolume === 'number' ? clampVolume(parsed.streamVolume) : 1,
    };
  } catch {
    return { ...DEFAULT_PREFS, volumes: {}, muted: {} };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be full/blocked — the in-memory state still works
  }
}

/** Radio volume lives in its own key so voice prefs can be reset freely. */
export function loadRadioVolume(): number {
  const stored = localStorage.getItem(RADIO_VOLUME_KEY);
  if (stored === null) return 0.8;
  const value = Number(stored);
  return Number.isFinite(value) ? clampVolume(value) : 0.8;
}

export function saveRadioVolume(value: number): void {
  localStorage.setItem(RADIO_VOLUME_KEY, String(clampVolume(value)));
}

export function loadRadioMuted(): boolean {
  return localStorage.getItem(RADIO_MUTED_KEY) === '1';
}

export function saveRadioMuted(muted: boolean): void {
  localStorage.setItem(RADIO_MUTED_KEY, muted ? '1' : '0');
}

export { clampVolume };
