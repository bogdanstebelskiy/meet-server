# Architecture

This is a mediasoup SFU (selective forwarding unit) signaling server for video calls, split across two NestJS apps by *rate of change*: `apps/sfu` owns the mediasoup side, `apps/realtime` owns everything client-facing, and they talk over a REST API described by `libs/media-contracts`. The reference implementation is [mediasoup-demo v3](https://github.com/versatica/mediasoup-demo/tree/v3); see `docs/adr/0001-separate-sfu-and-realtime-apps.md` for why the split happened and `CONTEXT.md` for the `Room`/`MediaRoom`/`Peer` vocabulary used throughout.

Per-app module breakdown lives in each app's own `CLAUDE.md` (`apps/sfu/CLAUDE.md`, `apps/realtime/CLAUDE.md`) — read this file for what's shared across both.

Full design reasoning (why the module split, why least-loaded over round-robin, why two transports per peer, why socket.io over protoo, mediasoup typing gotchas, LAN/HTTPS testing requirements, etc.) is in `docs/sfu-signaling-design.md` — read it before changing anything in `sfu`/`rooms`/`signaling`, since most non-obvious decisions there are already justified and shouldn't be re-litigated without reading why first.

## Cross-cutting

- **WS exception handling**: `apps/realtime/src/common/ws-exception.filter.ts` re-wraps `HttpException`s as `WsException` so their real message reaches the client (Nest's default WS error handling only preserves messages for `WsException` itself). `@nestjs/websockets` has no global WS filter support, so every gateway must apply `@UseFilters(new WsExceptionFilter())` itself — it will silently not apply otherwise.
- **Ack payloads**: every WS handler must return a non-nil object. `@nestjs/platform-socket.io` silently drops `undefined`/`null` handler returns, so a client awaiting the ack hangs forever with no error.
- **Local network testing**: `apps/sfu`'s `WebRtcConfigService.announcedAddress` (env var `WEBRTC_ANNOUNCED_ADDRESS`) must be a real LAN IP (not `0.0.0.0`/`127.0.0.1`) for cross-device/browser testing to work; it warns and falls back to `127.0.0.1` if unset. `apps/realtime/main.ts` loads HTTPS certs from `certificates/` (mkcert-generated, gitignored) when present, since phone/LAN testing needs TLS to avoid mixed-content WS blocking.

## Test strategy

Three tiers, matched to what each can actually prove:
- **Unit** (`apps/*/test/unit`, Jest root config): worker-picker, room/MediaRoom join-leave state machines, message dispatch, `SfuClientService`'s HTTP-error-to-`HttpException` reconstruction — all mockable, no real mediasoup process and no real HTTP calls.
- **E2E** (`apps/*/test/*.e2e-spec.ts`, each app's own `test/jest-e2e.json`): real Nest apps, real mediasoup workers, real socket.io clients. `apps/realtime`'s suite boots a real `apps/sfu` app too (ephemeral port, wired via `SFU_SERVICE_URL`) so the two communicate over real HTTP, not mocks — matching how they actually run in production. Fabricated but syntactically valid `dtlsParameters` stand in for a browser's ICE/DTLS since the signaling RPCs don't block on actual connectivity. This tier has caught every non-obvious bug recorded in `docs/sfu-signaling-design.md`.
- **Browser e2e**: not implemented (no client in this repo) — would be the only tier proving real ICE/DTLS negotiation and multi-tab UX.
