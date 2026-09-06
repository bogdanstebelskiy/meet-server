# Static multi-instance `sfu` with sticky, least-loaded room routing

`apps/sfu` scaled to exactly one instance until now (`SfuClientService` called a single fixed `SFU_SERVICE_URL`). The goal driving this change is narrower than general SFU high availability: measuring how load capacity scales as `apps/sfu` replicas are added, with and without replication, on one benchmark machine. That only requires spreading *new* rooms across several instances — not migrating a room mid-call, and not surviving an instance crashing under an in-progress room.

## Decision

- `apps/realtime` is configured with a static, comma-separated list of `sfu` instance URLs (`SFU_SERVICE_URLS`), not a single URL. No load balancer or service-discovery layer sits in front of `apps/sfu` — `SfuClientService` always targets one instance's URL explicitly, per call.
- Each `apps/sfu` instance exposes its current room count via `GET /media-rooms/stats`. Room count (not CPU/consumer load) is the load signal: cheap to read, and adequate for balancing *new* room placement, which is all this needs.
- A room picks its instance once, at creation (`RoomsService.createRoom` calling `SfuRegistryService.pickLeastLoaded`), and is stuck to it for the room's lifetime — mediasoup `Router`s don't migrate between processes (`docs/sfu-signaling-design.md`). The choice is persisted on the `Room` record already stored in Redis (`sfuNodeUrl` field), so it survives across `apps/realtime` instances and process restarts.
- `WorkerPoolService`'s worker-pool size is now configurable (`SFU_WORKER_POOL_SIZE`, `WorkerSettingsConfigService.numWorkers`) instead of always reading `os.cpus().length` — needed to run more than one `apps/sfu` replica on a single benchmark machine without every replica spawning a worker per host core and fighting over the same CPUs.

## Explicitly out of scope

- **Dead-instance recovery.** If a room's pinned instance dies mid-call, that room stays broken until every peer disconnects (`RoomsService`/`MediaRoomsService`'s existing TTL/emptiness cleanup is the only safety net) — no health-checking, no reassignment, no client-facing recovery event. Revisit only if real usage (not this benchmarking goal) demands it.
- **Cross-node media (`pipeToRouter`).** A single room is always served entirely by one `sfu` instance. Splitting one room's media across instances remains deferred, same as it was pre-multi-instance.
- **Service discovery / autoscaling.** The instance list is static config, read once. Adding/removing a replica means redeploying `apps/realtime` with a new list.

## Consequences

`apps/realtime` and `apps/sfu` stay decoupled the same way ADR-0001 intends — `apps/sfu` has no idea multiple instances of itself exist. Running exactly one `SFU_SERVICE_URLS` entry (today's default) reproduces the old single-instance behavior exactly, so this is additive, not a breaking change to existing deployments.
