/**
 * Mahyar Radio — Cloudflare Worker relay
 * =======================================
 *
 * RadioX (stream.radiox.pro) is hosted in IRAN. Routes from US/EU datacenters
 * (Railway) to Iranian servers are unstable, so the radio worker inside
 * Railway cannot reliably reach the stream directly. Cloudflare's network has
 * a solid path to Iran — this worker relays the station streams so Railway's
 * ffmpeg connects to Cloudflare instead of Iran directly.
 *
 * Setup (5 minutes, free plan is enough):
 *   1. dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Paste this file's content → Deploy
 *   3. Copy the worker URL (https://<name>.<account>.workers.dev)
 *   4. Worker → Settings → Variables → add:
 *        RADIO_RELAY_KEY = <a long random string of your choice>
 *   5. In Railway (mahyar-gap service) add:
 *        RADIO_RELAY_BASE = https://<name>.<account>.workers.dev/stream
 *        RADIO_RELAY_KEY  = <the same random string>
 *   6. Restart the Railway deployment. Done — click a station in the app.
 *
 * Security: the KEY query parameter makes sure only YOUR app can use this
 * relay. The station allowlist lives here, so the relay cannot be used to
 * reach arbitrary hosts.
 */

const STATIONS = {
  popularfa: 'https://stream.radiox.pro/listen/popularfa/radio.mp3',
  souls: 'https://stream.radiox.pro/listen/souls/radio.mp3',
  shooti: 'https://stream.radiox.pro/listen/shooti/radio.mp3',
  popular: 'https://stream.radiox.pro/listen/popular/radio.mp3',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/stream/')) {
      return new Response('Mahyar Radio relay is running.\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const stationId = url.pathname.slice('/stream/'.length).replace(/[^a-z0-9]/g, '');
    const target = STATIONS[stationId];
    if (!target) {
      return new Response('unknown station\n', { status: 404 });
    }

    const accessKey = (env.RADIO_RELAY_KEY ?? '').trim();
    if (accessKey && url.searchParams.get('key') !== accessKey) {
      return new Response('forbidden\n', { status: 403 });
    }

    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'MahyarRadio/1.0',
        'Icy-MetaData': '1',
        Accept: '*/*',
      },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Relay-Station': stationId,
      },
    });
  },
};
