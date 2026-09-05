# Meet Server

Signaling and media-forwarding backend for group video calls. Clients join a call over WebSocket, negotiate WebRTC media through a mediasoup SFU (selective forwarding unit), and exchange chat over the same room.

The server is split into two independently deployable NestJS apps, by rate of change:

- **`apps/realtime`** — everything client-facing: the socket.io signaling gateway, `Room`/`Peer` membership state (Redis-backed), and chat. Talks to `apps/sfu` over REST for anything mediasoup-related.
- **`apps/sfu`** — the mediasoup side: a pool of `Worker` processes and `MediaRoom`/`MediaPeer` state, exposed as a REST API.
- **`libs/media-contracts`** — the REST request/response DTOs shared by both apps.

See [`CONTEXT.md`](./CONTEXT.md) for the domain vocabulary (`Room` vs `MediaRoom` vs `Peer`) and [`docs/adr/0001-separate-sfu-and-realtime-apps.md`](./docs/adr/0001-separate-sfu-and-realtime-apps.md) for why the split happened. Architecture details, cross-cutting gotchas, and the test strategy live in [`docs/architecture.md`](./docs/architecture.md).

## Prerequisites

- Node.js and npm
- Redis (only `apps/realtime` needs it — for room state and chat history)
- A build toolchain able to compile mediasoup's native bindings (`apps/sfu` depends on it directly)
- [mkcert](https://github.com/FiloSottile/mkcert), if you want HTTPS locally (see below)

## Install

```bash
npm install
```

This is a Nest CLI monorepo (`nest-cli.json` has `"monorepo": true`) — one `package.json`, shared `libs/`, two apps under `apps/`.

## Running locally

`apps/realtime` needs a running `apps/sfu` to do anything past a bare WS connection — `join`, `produce`, `consume`, etc. all call out to it. Run both, on different ports (both default to `3000` if `PORT` is unset, so starting both without setting it crashes the second one with `EADDRINUSE`):

```bash
# terminal 1 — apps/sfu
PORT=3002 npx nest start sfu --watch

# terminal 2 — apps/realtime
SFU_SERVICE_URL=http://localhost:3002 npm run start:dev
```

`SFU_SERVICE_URL` defaults to `http://localhost:3001` when unset — pick whatever port is actually free on your machine and set both `PORT` (for `apps/sfu`) and `SFU_SERVICE_URL` (for `apps/realtime`) to match. If you point `apps/realtime` at a port nothing is listening on, you'll get a "socket hang up"/connection-reset error rather than a clean "connection refused".

You'll also want a local Redis running on the default port (`redis://localhost:6379`), or set `REDIS_URL` to point elsewhere. Without one, `apps/realtime` still boots and serves HTTP, but chat history won't work and you'll see `ioredis` connection errors logged in the background.

### HTTPS for cross-device/LAN testing

Testing from a phone or another device on your LAN needs TLS, since browsers block mixed-content WebSocket connections over plain HTTP. `apps/realtime`'s `main.ts` picks up mkcert-generated certs from `certificates/` (gitignored) automatically if present:

```bash
mkcert -install
mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost <your-lan-ip>
```

For real cross-device ICE negotiation (not just loopback), also set `WEBRTC_ANNOUNCED_ADDRESS` on `apps/sfu` to your machine's actual LAN IP — see [Configuration](#configuration) below.

## Configuration

Environment variables, all optional with the fallbacks noted:

| Variable | App | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | both | `3000` | Set differently per app when running both locally. |
| `SFU_SERVICE_URL` | realtime | `http://localhost:3001` | Base URL `apps/realtime` uses to call `apps/sfu`. |
| `REDIS_URL` | realtime | `redis://localhost:6379` | Room state and chat history. |
| `REDIS_AUTH` | realtime | unset | Redis password, if required. |
| `WEBRTC_ANNOUNCED_ADDRESS` | sfu | `127.0.0.1` | Must be a real LAN IP (not `0.0.0.0`/`127.0.0.1`) for cross-device WebRTC ICE to actually connect. Warns and falls back if unset. |
| `WEBRTC_PORT_RANGE_MIN` / `WEBRTC_PORT_RANGE_MAX` | sfu | `40000` / `49999` | UDP/TCP port range mediasoup transports listen on. |

## Commands

```bash
npm run build          # nest build (bare command defaults to the "realtime" project)
npx nest build sfu     # build a specific app explicitly
npm run start:dev      # watch mode, defaults to "realtime"
npm run lint           # eslint --fix on apps/libs
npm run format         # prettier --write on apps/libs

npm run test           # unit tests (apps/**/*.spec.ts, libs/**/*.spec.ts)
npm run test:watch
npm run test:cov
npm run test:e2e       # e2e for apps/realtime — boots real apps/realtime + apps/sfu (real mediasoup workers) over real HTTP/socket.io, no browser
npm run test:e2e:sfu   # e2e for apps/sfu — real Nest app + real mediasoup workers, driven directly over HTTP with supertest
```

Run a single unit test file:

```bash
npx jest apps/realtime/test/unit/rooms/rooms.service.spec.ts
```

Run a single e2e test file:

```bash
npx jest --config ./apps/realtime/test/jest-e2e.json apps/realtime/test/signaling.e2e-spec.ts
```

Unit and e2e tests use separate Jest configs (root `package.json` vs each app's `test/jest-e2e.json`), so `npm test` won't pick up `*.e2e-spec.ts` files or vice versa.

## Docker

Each app has its own multi-stage `Dockerfile`, built from the repo root since both apps share the root `package.json` and `libs/`:

```bash
docker build -f apps/realtime/Dockerfile -t meet-realtime .
docker build -f apps/sfu/Dockerfile -t meet-sfu .

docker run -p 3001:3000 --name sfu meet-sfu
docker run -p 3000:3000 -e REDIS_URL=redis://<host>:6379 -e SFU_SERVICE_URL=http://<sfu-host>:3001 meet-realtime
```

`apps/realtime` needs `SFU_SERVICE_URL` pointed at a reachable `apps/sfu` instance and a reachable Redis at `REDIS_URL` for chat history — see [Configuration](#configuration).

## Documentation

- [`CONTEXT.md`](./CONTEXT.md) — domain vocabulary (`Room`, `MediaRoom`, `Peer`, `Session`)
- [`docs/architecture.md`](./docs/architecture.md) — module split, cross-cutting gotchas, test strategy
- [`docs/sfu-signaling-design.md`](./docs/sfu-signaling-design.md) — full design reasoning behind the SFU/signaling implementation (least-loaded worker selection, transport design, socket.io choice, mediasoup typing gotchas, LAN/HTTPS testing requirements)
- [`docs/adr/`](./docs/adr) — architecture decision records
- `apps/sfu/CLAUDE.md`, `apps/realtime/CLAUDE.md` — per-app module breakdown

## License

UNLICENSED (private).
