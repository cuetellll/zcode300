/**
 * Mahyar Radio — station catalog (server-side only).
 *
 * Stream URLs never leave the server: the browser only receives id/title/
 * description. Client commands reference a station by its allowlisted id —
 * arbitrary URLs from clients are never accepted (SSRF protection).
 */

export interface RadioStation {
  id: string;
  title: string;
  description: string;
  streamUrl: string;
}

export const RADIO_STATIONS: readonly RadioStation[] = [
  {
    id: 'popularfa',
    title: 'بهترین رپ فارسی',
    description: 'Rap Farsi',
    streamUrl: 'https://stream.radiox.pro/listen/popularfa/radio.mp3',
  },
  {
    id: 'souls',
    title: 'Souls',
    description: 'ایستگاه Souls',
    streamUrl: 'https://stream.radiox.pro/listen/souls/radio.mp3',
  },
  {
    id: 'shooti',
    title: 'Shooti',
    description: 'ایستگاه Shooti',
    streamUrl: 'https://stream.radiox.pro/listen/shooti/radio.mp3',
  },
  {
    id: 'popular',
    title: 'Popular',
    description: 'محبوب‌ترین‌ها',
    streamUrl: 'https://stream.radiox.pro/listen/popular/radio.mp3',
  },
] as const;

export function findRadioStation(id: string): RadioStation | undefined {
  return RADIO_STATIONS.find((station) => station.id === id);
}

export interface PublicRadioStation {
  id: string;
  title: string;
  description: string;
}

export function publicStation(station: RadioStation): PublicRadioStation {
  return { id: station.id, title: station.title, description: station.description };
}

/**
 * Where the radio worker should fetch the station from.
 *
 * The stream is hosted in IRAN; US/EU datacenter routes to it are unreliable.
 * When RADIO_RELAY_BASE is configured (a Cloudflare Worker relay with a solid
 * Iran route), the worker fetches through it — same allowlist, same key
 * protection, same "no client-supplied URLs" property.
 */
export function stationSourceUrl(station: RadioStation): string {
  const base = (process.env.RADIO_RELAY_BASE ?? '').trim().replace(/\/+$/, '');
  if (!base) return station.streamUrl;
  const key = (process.env.RADIO_RELAY_KEY ?? '').trim();
  const separator = base.includes('?') ? '&' : '?';
  return `${base}/${station.id}${key ? `${separator}key=${encodeURIComponent(key)}` : ''}`;
}

export const RADIO_BOT_NAME = 'Mahyar Radio';
export function radioBotIdentity(channelId: string): string {
  return `mahyar-radio-${channelId}`;
}
export function isRadioBotIdentity(identity: string | undefined): boolean {
  return typeof identity === 'string' && identity.startsWith('mahyar-radio-');
}
