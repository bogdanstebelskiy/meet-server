# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a Nest CLI monorepo (`nest-cli.json` has `"monorepo": true`): `apps/realtime` (today's whole app — signaling, rooms, chat, redis, sfu worker pool), `apps/sfu` (empty skeleton — mediasoup state moves here in issue #16), and `libs/media-contracts` (empty shell — REST DTOs land here alongside #16). See `CONTEXT.md` and `docs/adr/0001-separate-sfu-and-realtime-apps.md` for why.

```bash
npm run build          # nest build (bare command defaults to the "realtime" project)
npx nest build sfu     # build a specific app explicitly
npm run start:dev      # watch mode, defaults to "realtime"
npm run lint           # eslint --fix on apps/libs
npm run format         # prettier --write on apps/libs

npm run test           # unit tests (apps/**/*.spec.ts, libs/**/*.spec.ts), via root jest config in package.json
npm run test:watch
npm run test:cov
npm run test:e2e       # e2e tests (apps/realtime/test/**/*.e2e-spec.ts), via apps/realtime/test/jest-e2e.json — spins up a real Nest app + real mediasoup workers + real socket.io clients, no browser
npm run test:e2e:sfu   # e2e tests for apps/sfu, via apps/sfu/test/jest-e2e.json — currently just the default Nest scaffold smoke test; real coverage lands with #16
```

Run a single unit test file: `npx jest apps/realtime/test/unit/rooms/rooms.service.spec.ts`
Run a single e2e test file: `npx jest --config ./apps/realtime/test/jest-e2e.json apps/realtime/test/signaling.e2e-spec.ts`

Unit and e2e tests use separate Jest configs (root `package.json` vs each app's `test/jest-e2e.json`) with different `testRegex`/`roots` — don't expect `npm test` to pick up `*.e2e-spec.ts` files or vice versa. Each app carries its own `test/jest-e2e.json`.

### Docker

Each app has its own multi-stage `Dockerfile` (`apps/realtime/Dockerfile`, `apps/sfu/Dockerfile`), proving the two apps are independently buildable and deployable per `docs/adr/0001-separate-sfu-and-realtime-apps.md`. Both share the root `package.json`/`libs/`, so the build context is the repo root, not the app directory:

```bash
docker build -f apps/realtime/Dockerfile -t meet-realtime .
docker build -f apps/sfu/Dockerfile -t meet-sfu .

docker run -p 3000:3000 -e REDIS_URL=redis://<host>:6379 meet-realtime
docker run -p 3000:3000 meet-sfu
```

`apps/sfu`'s image is a functional no-op until #16 (mediasoup state migration) lands — it only proves the packaging mechanics work. `apps/realtime` still needs a reachable Redis at `REDIS_URL` for chat history; without one it still boots and serves HTTP, but logs `ioredis` connection errors in the background.

## Architecture

This is a mediasoup SFU (selective forwarding unit) signaling server for video calls, built on NestJS with socket.io gateways. The reference implementation is [mediasoup-demo v3](https://github.com/versatica/mediasoup-demo/tree/v3); this repo maps that reference onto three NestJS modules split by *rate of change*, not by layer:

- **`sfu`** — owns mediasoup `Worker` processes only. One worker per CPU core, spawned at `onModuleInit`. Hands out the least-loaded worker (by router count, not round-robin) for `rooms` to create a `Router` on. Knows nothing about rooms, peers, or signaling. A worker `died` event exits the process entirely (no in-process recovery) — restart is a process manager's job (pm2/systemd/k8s). `mediaCodecs` (the RTP capability contract) lives in `sfu/config`, not `rooms`, even though `rooms` consumes it when calling `createRouter`.
- **`rooms`** — owns `Router` + peer membership, no WS/transport code. `RoomsService` is a `Map<roomId, Room>`; rooms are created lazily on first join and closed when the last peer leaves. `Room` = one `Router` (fetched once from `sfu` at creation, never migrated between workers) + `Map<peerId, Peer>`. `Peer` holds two `WebRtcTransport`s (send + recv) plus its producers/consumers. `getOrCreateRoom` dedupes concurrent room creation via a `pendingRooms: Map<roomId, Promise<Room>>` so two peers joining a brand-new room at the same instant don't each create their own router.
- **`signaling`** — the only module that talks to clients (`SignalingGateway`, socket.io). Translates WS request/ack events (`join`, `createWebRtcTransport`, `produce`, `consume`, `pauseProducer`, etc.) into calls against `rooms`/mediasoup objects, and pushes server-initiated notifications (`newPeer`, `newProducer`, `producerPaused`, `peerClosed`, etc.) back out. `join`'s ack only returns `existingPeers`; producers of already-joined peers are backfilled to the new socket via direct (non-broadcast) `newProducer` emits right after the join ack, since that's otherwise the only event that tells a client about a producer.
- **`chat`** — text chat backed by Redis Streams (`XADD`/`XRANGE`, capped with `MAXLEN ~`), keyed per room (`chat:<roomId>`), so history resumes from the last seen message ID. Depends on `redis` and `rooms`. `ChatModule` is not currently imported into `AppModule`.
- **`redis`** — single `ioredis` client behind the `REDIS_CLIENT` DI token; connection config from `REDIS_URL`/`REDIS_AUTH` env vars.

Full design reasoning (why the module split, why least-loaded over round-robin, why two transports per peer, why socket.io over protoo, mediasoup typing gotchas, LAN/HTTPS testing requirements, etc.) is in `docs/sfu-signaling-design.md` — read it before changing anything in `sfu`/`rooms`/`signaling`, since most non-obvious decisions there are already justified and shouldn't be re-litigated without reading why first.

### Cross-cutting

- **WS exception handling**: `apps/realtime/src/common/ws-exception.filter.ts` re-wraps `HttpException`s as `WsException` so their real message reaches the client (Nest's default WS error handling only preserves messages for `WsException` itself). `@nestjs/websockets` has no global WS filter support, so every gateway must apply `@UseFilters(new WsExceptionFilter())` itself — it will silently not apply otherwise.
- **Ack payloads**: every WS handler must return a non-nil object. `@nestjs/platform-socket.io` silently drops `undefined`/`null` handler returns, so a client awaiting the ack hangs forever with no error.
- **Local network testing**: `apps/realtime/src/sfu/config`'s `webRtcAnnouncedAddress` must be a real LAN IP (not `0.0.0.0`/`127.0.0.1`) for cross-device/browser testing to work. `main.ts` loads HTTPS certs from `certificates/` (mkcert-generated, gitignored) when present, since phone/LAN testing needs TLS to avoid mixed-content WS blocking.

### Test strategy

Three tiers, matched to what each can actually prove:
- **Unit** (`apps/realtime/test/unit`, Jest root config): worker-picker, room join/leave state machine, message dispatch — all mockable, no real mediasoup process.
- **E2E** (`apps/realtime/test/*.e2e-spec.ts`, `apps/realtime/test/jest-e2e.json`): real Nest app, real mediasoup workers, real socket.io clients; fabricated but syntactically valid `dtlsParameters` stand in for a browser's ICE/DTLS since the signaling RPCs don't block on actual connectivity. This tier has caught every non-obvious bug recorded in `docs/sfu-signaling-design.md`.
- **Browser e2e**: not implemented (no client in this repo) — would be the only tier proving real ICE/DTLS negotiation and multi-tab UX.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (github.com/bogdanstebelskiy/meet-server), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
