# Mahyar Gap

A private, Discord-inspired communication space for a small circle of friends: real-time chat, voice, video, screen sharing — and **Mahyar Radio**, a shared live radio for every voice room.

> فارسی: [README.fa.md](./README.fa.md)

---

## Stack

| Layer      | Technology |
|------------|------------|
| Web app    | React 18 + TypeScript + Vite + Tailwind CSS (RTL/LTR, fa/en) |
| API        | Node.js 22, Express, Socket.IO, Zod, Prisma |
| Database   | PostgreSQL (Railway) |
| Realtime   | Socket.IO (authorized rooms, presence, typing, voice state, radio state) |
| Voice/Video| LiveKit (mic, camera, screen share + audio) |
| Radio      | Python worker (`livekit` / livekit.rtc) + FFmpeg, spawned **on demand** as a child process |
| Storage    | Railway S3-compatible private bucket (chat attachments only) |

## Repository layout

```
apps/
  api/                 Node.js backend (modular: modules/, realtime/, workers/, storage/)
    prisma/            schema + migrations (history preserved; see "Migration safety")
    src/
      config/          env, permission catalog, radio stations (server-side only)
      modules/         auth, users, servers, channels, messages, direct-messages,
                       friends, files, voice, radio, notifications
      realtime/        Socket.IO gateway (every event authorized against the DB)
      storage/         generic S3 helpers (bucket stays private; streams through the API)
      workers/         radio-worker-manager.ts (lazy Python child processes)
  web/                 React SPA (features/ per domain, i18n fa/en, dark/light theme)
workers/
  radio/               Python radio worker: main.py, stream_decoder.py,
                       livekit_publisher.py, protocol.py, poc.py
```

## What the radio actually is

`Mahyar Radio` is **not** an HTML audio player. When the first member of a voice
room picks a station, the API spawns one Python worker for that room. The worker:

1. connects to the LiveKit room as a real participant (`mahyar-radio-<channelId>`, name `Mahyar Radio`),
2. probes the stream with ffprobe (never trusting the `.mp3` extension — RadioX serves AAC),
3. decodes the HTTP stream with FFmpeg into 10 ms PCM frames (48 kHz stereo),
4. publishes them as a real audio track so everyone in the room hears it through the voice path.

Guarantees:

- **Zero work at boot** — no FFmpeg, no worker, no stream connection until the
  first validated play command.
- **One stream per room** — switching stations warms the new decoder first and
  swaps only after it produces healthy audio; the old stream is never mixed in.
- **Idle shutdown** — when the last human leaves the room, the worker and its
  FFmpeg process are stopped after `RADIO_IDLE_SHUTDOWN_MS` (default 30 s).
- **Station switching is room-wide**; stop is room-wide too.
- **Per-client volume** — the volume slider only changes local playback.
- **Failure is honest** — `LIVE` is shown only after the track is actually
  published; stream errors surface in the UI with a retry.
- **`RADIO_MAX_ACTIVE_ROOMS=1`** by default to protect small Railway instances.
- **No client URLs** — stations are an allowlisted server-side catalog; a
  command references a station id, never a URL (SSRF-safe).
- After a restart/deploy the radio state is `stopped` — no orphan workers, no
  auto-resume, no double audio.

> ⚠️ **Licensing note:** the four RadioX streams are publicly reachable URLs,
> but public reachability is not a redistribution license. Use them privately
> as intended; do not record or rebroadcast. No DRM or access control is bypassed.

## Auth model

- **Access token:** 15-minute JWT, kept in client memory only (never
  localStorage, never a cookie).
- **Refresh token:** opaque 32-byte random value in an `HttpOnly`,
  `SameSite=Lax`, `Path=/api/auth` cookie; stored **hashed** (SHA-256) in the
  `Session` table and **rotated on every refresh**. Unknown-token refresh
  attempts clear the cookie (theft signal).
- Passwords: Argon2id (`@node-rs/argon2`).
- CSRF: cookie endpoints are `SameSite=Lax` + Origin-checked.
- All REST routes and every Socket.IO event re-check permissions server-side.

## Migration safety (READ BEFORE FIRST DEPLOY)

The migration history is **preserved**, and one new forward-only migration
(`20261105000000_radio_rebuild`) does the following in a single transaction:

1. converts legacy JSON reactions/attachments into proper relational rows,
2. drops the retired music subsystem (`MusicTrack`, `MusicPlaylist`,
   `MusicPlaylistTrack`, `Server.musicEnabled`),
3. drops dead columns and the unused `FriendRequest` table.

**No user, message, DM, server, channel or attachment data is deleted.**
Malformed legacy JSON rows are skipped with a warning instead of failing.

⚠️ **Always take a backup first** (from any machine with `psql` access):

```bash
pg_dump "$DATABASE_URL" --no-owner -Fc -f mahyar-gap-backup.dump
# restore (only if ever needed):
# pg_restore -d "$DATABASE_URL" --clean --if-exists mahyar-gap-backup.dump
```

⚠️ **Never** run `prisma migrate reset` against the production database.
`prisma migrate deploy` (wired in the start command) only applies pending
migrations and is the only database command this project runs automatically.

## Local development

Requirements: Node 20+, a PostgreSQL database, and (optionally, for the radio)
FFmpeg + Python 3.11+ with `pip install -r workers/radio/requirements.txt`.

```bash
npm install            # workspaces (api + web)
npm run db:generate    # prisma client
npm run db:deploy      # apply migrations
cp .env.example apps/api/.env   # fill in values
npm run dev:api        # http://localhost:3000
npm run dev:web        # http://localhost:5173 (proxies /api + socket.io)
```

## Railway deployment

1. Push this repository to GitHub (CI runs typecheck, build, unit tests and
   applies migrations to an empty Postgres — see `.github/workflows/ci.yml`).
2. Railway: **New Project** → deploy from the repo. Railway detects
   `railway.json` → Dockerfile builder. One **Web Service**, one **PostgreSQL**,
   one **Bucket** (private).
3. In the web service Variables, reference the Postgres and Bucket variables
   (`DATABASE_URL`, `AWS_*`) and add the rest from `.env.example`
   (`JWT_ACCESS_SECRET`, `LIVEKIT_*`, `RADIO_*`).
4. Deploy. The start command runs `prisma migrate deploy` then the API —
   **take the `pg_dump` backup before the first deploy against existing data**.
5. Check `https://<your-app>.up.railway.app/api/health` → `{"status":"ok"}`.

## Radio worker verification (POC)

Run the standalone proof of concept on any machine (or the Railway container
shell) with Python + FFmpeg:

```bash
python3 workers/radio/poc.py \
  --livekit-url wss://… --api-key … --api-secret … \
  --room poc-radio-room --duration 60
```

Join `poc-radio-room` from any LiveKit client: you should hear the station,
see the `poc-radio` participant, and everything must stop cleanly afterwards.

## Removed from the previous generation (on purpose)

- The whole browser-sync music subsystem: `server/music/engine.ts|library.ts|
  register.ts`, `/api/music/*`, `js/music.js`, `/mp` commands, `music:*` socket
  events, `MusicTrack`/`MusicPlaylist`/`MusicPlaylistTrack` models,
  `musicEnabled`, all `MUSIC_*` env vars. Storage helpers lived inside the music
  module — they were extracted to `apps/api/src/storage/` first, and attachments
  were verified to keep working through the same private-bucket path.
- Announcement/Forum/Stage channel types (label-only in the old app).
- The generic `/tables/:table` CRUD API (replaced by explicit, authorized
  endpoints per domain).
- Marketing landing pages (not part of the product; auth is the entry point).
- `FriendRequest` table (never used), `discriminator`, `emailVerified`,
  `twoFactorEnabled`, `threadName` (half-implemented threads → reply chains
  remain, labels removed).

## Known limitations

- Presence and radio sessions are in-memory → **single replica only**
  (`numReplicas: 1`). The radio manager is bound to one process by design.
- Unread badges are client-side (localStorage), like the previous generation.
- LiveKit tokens are not revoked on role *changes* (only on kick/ban); the
  30-minute token TTL bounds exposure.
- The four station streams and their licensing status are documented above;
  if a stream becomes unreachable, the UI shows the real error with a retry.
