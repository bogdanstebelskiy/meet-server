# apps/sfu

Guidance specific to `apps/sfu`. See root `CLAUDE.md` for commands, and `docs/architecture.md` for the shared split rationale, cross-cutting concerns, and test strategy.

`apps/sfu` owns the mediasoup side: `Worker` pool and `MediaRoom`/`MediaPeer` state, exposed as a REST API consumed by `apps/realtime`.

- **`workers`** (`WorkerPoolService`) — owns mediasoup `Worker` processes only. One worker per CPU core, spawned at `onModuleInit`. Hands out the least-loaded worker (by router count, not round-robin) for `media-rooms` to create a `Router` on. A worker `died` event exits the process entirely (no in-process recovery) — restart is a process manager's job (pm2/systemd/k8s).
- **`media-rooms`** — owns `Router` + `MediaPeer` transports/producers/consumers, exposed via `MediaRoomsController`'s REST API (create-or-get room, create/connect transport, produce, consume, resume consumer, pause/resume producer — all keyed by `roomId`/`peerId`). `MediaRoomsService` is a `Map<roomId, MediaRoom>`; a `MediaRoom` = one `Router` (fetched once from `workers` at creation, never migrated) + `Map<peerId, MediaPeer>`, with peers created lazily on first `createTransport` call (no explicit "join" concept). `getOrCreateRoom` dedupes concurrent room creation via a `pendingRooms: Map<roomId, Promise<MediaRoom>>`. `mediaCodecs` and `webRtcAnnouncedAddress`/port range live in `apps/sfu/src/config` (the latter two via `WebRtcConfigService`, env-driven — see `docs/architecture.md`'s Cross-cutting section). No MediaRoom/peer teardown endpoint yet (tracked in issue #18): closed rooms on the `realtime` side just stop being referenced, they don't get cleaned up here.

Read `docs/sfu-signaling-design.md` before changing anything here — most non-obvious decisions (least-loaded over round-robin, worker-per-core, etc.) are already justified there.
