# Build context is the repo root (monorepo shares one package.json and libs/):
#   docker build -f apps/realtime/Dockerfile -t meet-realtime .
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# build-essential/python3: mediasoup's postinstall downloads a prebuilt worker
# binary and falls back to compiling it from source when no prebuild matches
# the host; without a toolchain that fallback path fails npm ci outright.
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs
RUN npx nest build realtime

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=builder /app/dist/apps/realtime ./dist/apps/realtime
EXPOSE 3000
CMD ["node", "dist/apps/realtime/main.js"]
