# ============================================================================
# Mahyar Gap — single Railway web service
#   - Node.js API + Socket.IO + built React web app (served statically)
#   - FFmpeg (radio stream decoding)
#   - Python venv with the LiveKit RTC SDK (lazy radio worker, started
#     on-demand by the API as a child process — never at boot)
# ============================================================================

# ----------------------------- build stage ----------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate

COPY . .
RUN npm run build -w @mahyar/api \
 && npm run build -w @mahyar/web

# Radio worker runtime (installed once; the container never pip-installs at boot)
RUN python3 -m venv /opt/radio-venv \
 && /opt/radio-venv/bin/pip install --no-cache-dir -r workers/radio/requirements.txt

# ----------------------------- runtime stage --------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl libstdc++6 \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version | head -1

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/workers/radio ./workers/radio
COPY --from=build /opt/radio-venv /opt/radio-venv

# Radio worker must exist where the API looks for it (see radioWorkerEntry()).
ENV RADIO_WORKER_PYTHON=/opt/radio-venv/bin/python

EXPOSE 3000
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && cd ../.. && exec node apps/api/dist/server.js"]
