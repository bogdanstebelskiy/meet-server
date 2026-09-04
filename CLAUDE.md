# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a Nest CLI monorepo (`nest-cli.json` has `"monorepo": true`): `apps/realtime` (signaling gateway, `Room`/`Peer` membership state, chat, redis — calls `apps/sfu` over REST for everything mediasoup-related), `apps/sfu` (mediasoup `Worker` pool and `MediaRoom`/`MediaPeer` state, exposed as a REST API), and `libs/media-contracts` (the REST request/response DTOs shared by both apps). See `CONTEXT.md` and `docs/adr/0001-separate-sfu-and-realtime-apps.md` for why.

```bash
npm run build          # nest build (bare command defaults to the "realtime" project)
npx nest build sfu     # build a specific app explicitly
npm run start:dev      # watch mode, defaults to "realtime"
npm run lint           # eslint --fix on apps/libs
npm run format         # prettier --write on apps/libs

npm run test           # unit tests (apps/**/*.spec.ts, libs/**/*.spec.ts), via root jest config in package.json
npm run test:watch
npm run test:cov
npm run test:e2e       # e2e tests (apps/realtime/test/**/*.e2e-spec.ts), via apps/realtime/test/jest-e2e.json — boots real apps/realtime + apps/sfu Nest apps (real mediasoup workers) wired together over real HTTP, driven by real socket.io clients, no browser
npm run test:e2e:sfu   # e2e tests for apps/sfu, via apps/sfu/test/jest-e2e.json — real Nest app + real mediasoup workers, driven directly over HTTP with supertest
```

Run a single unit test file: `npx jest apps/realtime/test/unit/rooms/rooms.service.spec.ts`
Run a single e2e test file: `npx jest --config ./apps/realtime/test/jest-e2e.json apps/realtime/test/signaling.e2e-spec.ts`

Unit and e2e tests use separate Jest configs (root `package.json` vs each app's `test/jest-e2e.json`) with different `testRegex`/`roots` — don't expect `npm test` to pick up `*.e2e-spec.ts` files or vice versa. Each app carries its own `test/jest-e2e.json`.

### Local dev (running both apps)

`npm run start:dev` only starts `apps/realtime`. Since #17, `apps/realtime` needs a running `apps/sfu` to do anything past a bare WS connection (`join`, `produce`, `consume`, etc. all call out to it) — run both, on different ports:

```bash
PORT=3002 npx nest start sfu --watch                              # apps/sfu
SFU_SERVICE_URL=http://localhost:3002 npm run start:dev           # apps/realtime
```

Both apps default to port 3000 (`process.env.PORT ?? 3000` in each `main.ts`) if `PORT` is unset, so starting both without setting it crashes the second one with `EADDRINUSE`. `SFU_SERVICE_URL` itself defaults to `http://localhost:3001` when unset — pick whatever port is actually free on your machine and set both `PORT` (for `apps/sfu`) and `SFU_SERVICE_URL` (for `apps/realtime`) to match; don't rely on the 3001 default colliding silently with something else already running there (a "socket hang up"/connection-reset error instead of a clean "connection refused" is the symptom of exactly that).

### Docker

Each app has its own multi-stage `Dockerfile` (`apps/realtime/Dockerfile`, `apps/sfu/Dockerfile`), proving the two apps are independently buildable and deployable per `docs/adr/0001-separate-sfu-and-realtime-apps.md`. Both share the root `package.json`/`libs/`, so the build context is the repo root, not the app directory:

```bash
docker build -f apps/realtime/Dockerfile -t meet-realtime .
docker build -f apps/sfu/Dockerfile -t meet-sfu .

docker run -p 3001:3000 --name sfu meet-sfu
docker run -p 3000:3000 -e REDIS_URL=redis://<host>:6379 -e SFU_SERVICE_URL=http://<sfu-host>:3001 meet-realtime
```

`apps/realtime` needs `SFU_SERVICE_URL` pointed at a reachable `apps/sfu` instance for anything past a bare WS connection (`join`, `produce`, `consume`, etc. all call out to it) — it defaults to `http://localhost:3001` when unset, which only works if both apps happen to run on the same host. It also still needs a reachable Redis at `REDIS_URL` for chat history; without one it still boots and serves HTTP, but logs `ioredis` connection errors in the background.

## Architecture

This is a mediasoup SFU (selective forwarding unit) signaling server for video calls, split across two NestJS apps by *rate of change*: `apps/sfu` owns the mediasoup side, `apps/realtime` owns everything client-facing, and they talk over a REST API described by `libs/media-contracts`. The reference implementation is [mediasoup-demo v3](https://github.com/versatica/mediasoup-demo/tree/v3); see `docs/adr/0001-separate-sfu-and-realtime-apps.md` for why the split happened and `CONTEXT.md` for the `Room`/`MediaRoom`/`Peer` vocabulary this section uses.

`apps/sfu`:
- **`workers`** (`WorkerPoolService`) — owns mediasoup `Worker` processes only. One worker per CPU core, spawned at `onModuleInit`. Hands out the least-loaded worker (by router count, not round-robin) for `media-rooms` to create a `Router` on. A worker `died` event exits the process entirely (no in-process recovery) — restart is a process manager's job (pm2/systemd/k8s).
- **`media-rooms`** — owns `Router` + `MediaPeer` transports/producers/consumers, exposed via `MediaRoomsController`'s REST API (create-or-get room, create/connect transport, produce, consume, resume consumer, pause/resume producer — all keyed by `roomId`/`peerId`). `MediaRoomsService` is a `Map<roomId, MediaRoom>`; a `MediaRoom` = one `Router` (fetched once from `workers` at creation, never migrated) + `Map<peerId, MediaPeer>`, with peers created lazily on first `createTransport` call (no explicit "join" concept). `getOrCreateRoom` dedupes concurrent room creation via a `pendingRooms: Map<roomId, Promise<MediaRoom>>`. `mediaCodecs` and `webRtcAnnouncedAddress`/port range live in `apps/sfu/src/config` (the latter two via `WebRtcConfigService`, env-driven — see Cross-cutting below). No MediaRoom/peer teardown endpoint yet (tracked in issue #18): closed rooms on the `realtime` side just stop being referenced, they don't get cleaned up here.

`apps/realtime`:
- **`rooms`** — owns `Room`/`Peer` membership only (id, display name, and for `Peer` the ids+kinds of its producers for join backfill) — no mediasoup objects. `RoomsService` is a `Map<roomId, Room>`; rooms are created lazily on first join (eagerly triggering `apps/sfu` MediaRoom creation via `SfuClientService`, same timing as before the split) and forgotten (not torn down — see the `apps/sfu` teardown gap above) when the last peer leaves. Its own `pendingRooms` dedup is independent of `apps/sfu`'s: it's guarding against two concurrent local `Room` creations silently dropping each other's first-added peer, not against a duplicate `MediaRoom`.
- **`sfu-client`** (`SfuClientService`) — the only thing in `realtime` that talks to `apps/sfu`, over `@nestjs/axios`, base URL from `SFU_SERVICE_URL`. Reconstructs a real `HttpException` from `apps/sfu`'s default Nest error body (`{statusCode, message}`) on any non-2xx response, so `WsExceptionFilter` surfaces the same message a client would have seen when this logic ran in-process.
- **`signaling`** — the only module that talks to clients (`SignalingGateway`, socket.io). Translates WS request/ack events (`join`, `createWebRtcTransport`, `produce`, `consume`, `pauseProducer`, etc.) into `rooms` membership updates plus `sfu-client` REST calls, and pushes server-initiated notifications (`newPeer`, `newProducer`, `producerPaused`, `peerClosed`, etc.) back out. `join`'s ack only returns `existingPeers`; producers of already-joined peers are backfilled to the new socket via direct (non-broadcast) `newProducer` emits right after the join ack, since that's otherwise the only event that tells a client about a producer.
- **`chat`** — text chat backed by Redis Streams (`XADD`/`XRANGE`, capped with `MAXLEN ~`), keyed per room (`chat:<roomId>`), so history resumes from the last seen message ID. Depends on `redis` and `rooms`. `ChatModule` is not currently imported into `AppModule`.
- **`redis`** — single `ioredis` client behind the `REDIS_CLIENT` DI token; connection config from `REDIS_URL`/`REDIS_AUTH` env vars.

Full design reasoning (why the module split, why least-loaded over round-robin, why two transports per peer, why socket.io over protoo, mediasoup typing gotchas, LAN/HTTPS testing requirements, etc.) is in `docs/sfu-signaling-design.md` — read it before changing anything in `sfu`/`rooms`/`signaling`, since most non-obvious decisions there are already justified and shouldn't be re-litigated without reading why first.

### Cross-cutting

- **WS exception handling**: `apps/realtime/src/common/ws-exception.filter.ts` re-wraps `HttpException`s as `WsException` so their real message reaches the client (Nest's default WS error handling only preserves messages for `WsException` itself). `@nestjs/websockets` has no global WS filter support, so every gateway must apply `@UseFilters(new WsExceptionFilter())` itself — it will silently not apply otherwise.
- **Ack payloads**: every WS handler must return a non-nil object. `@nestjs/platform-socket.io` silently drops `undefined`/`null` handler returns, so a client awaiting the ack hangs forever with no error.
- **Local network testing**: `apps/sfu`'s `WebRtcConfigService.announcedAddress` (env var `WEBRTC_ANNOUNCED_ADDRESS`) must be a real LAN IP (not `0.0.0.0`/`127.0.0.1`) for cross-device/browser testing to work; it warns and falls back to `127.0.0.1` if unset. `apps/realtime/main.ts` loads HTTPS certs from `certificates/` (mkcert-generated, gitignored) when present, since phone/LAN testing needs TLS to avoid mixed-content WS blocking.

### Test strategy

Three tiers, matched to what each can actually prove:
- **Unit** (`apps/*/test/unit`, Jest root config): worker-picker, room/MediaRoom join-leave state machines, message dispatch, `SfuClientService`'s HTTP-error-to-`HttpException` reconstruction — all mockable, no real mediasoup process and no real HTTP calls.
- **E2E** (`apps/*/test/*.e2e-spec.ts`, each app's own `test/jest-e2e.json`): real Nest apps, real mediasoup workers, real socket.io clients. `apps/realtime`'s suite boots a real `apps/sfu` app too (ephemeral port, wired via `SFU_SERVICE_URL`) so the two communicate over real HTTP, not mocks — matching how they actually run in production. Fabricated but syntactically valid `dtlsParameters` stand in for a browser's ICE/DTLS since the signaling RPCs don't block on actual connectivity. This tier has caught every non-obvious bug recorded in `docs/sfu-signaling-design.md`.
- **Browser e2e**: not implemented (no client in this repo) — would be the only tier proving real ICE/DTLS negotiation and multi-tab UX.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (github.com/bogdanstebelskiy/meet-server), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
