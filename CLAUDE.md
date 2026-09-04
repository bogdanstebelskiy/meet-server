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

## Code style

Repo-wide coding-style rules (no inline call arguments, no inline chain transformations, no ternaries/inline ifs, no explicit `undefined` returns, no types in service files) live in `.claude/rules/code-style.md`, which loads automatically for every session in this repo — nothing further to read here.

## Architecture

This is a mediasoup SFU (selective forwarding unit) signaling server for video calls, split across two NestJS apps by *rate of change*: `apps/sfu` owns the mediasoup side, `apps/realtime` owns everything client-facing, and they talk over a REST API described by `libs/media-contracts`. See `docs/adr/0001-separate-sfu-and-realtime-apps.md` for why the split happened and `CONTEXT.md` for the `Room`/`MediaRoom`/`Peer` vocabulary.

Each app has its own `CLAUDE.md` with its module breakdown (`apps/sfu/CLAUDE.md`, `apps/realtime/CLAUDE.md`) — Claude Code loads the relevant one automatically once you're reading/editing files in that app. See `docs/architecture.md` for what's shared across both: cross-cutting gotchas and the test strategy.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (github.com/bogdanstebelskiy/meet-server), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
