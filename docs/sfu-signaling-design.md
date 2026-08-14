# SFU / Signaling / Rooms - Design Reasoning

Reference implementation: [mediasoup-demo v3](https://github.com/versatica/mediasoup-demo/tree/v3).
This doc captures the reasoning behind how `meet-server` maps that reference onto its
NestJS module layout (`sfu`, `rooms`, `signaling`), and why specific choices were made.

## Why this module split

mediasoup-demo doesn't separate these concerns into distinct modules; its `server/`
directory mixes worker management, room state, and protoo signaling in a handful of
files. Splitting into three NestJS modules instead:

- **`sfu`**: owns mediasoup `Worker` processes only. Nothing here knows about rooms,
  peers, or signaling. Its only job: hand out a `Worker` to create a `Router` on, and
  track load so the pick is least-loaded rather than blind round-robin.
- **`rooms`**: owns `Router` + peer membership. A `Room` is one `Router` (from a
  worker `sfu` gave it) plus the peers currently in it. No WebSocket/transport code
  here, just state.
- **`signaling`**: the only module that talks to clients. Translates WS messages
  into calls against `rooms`/mediasoup objects, and pushes notifications back out.

Reasoning: worker lifecycle, room lifecycle, and wire protocol change for different
reasons and at different rates. Keeping them separate means the signaling protocol
(the part most likely to evolve: new message types, reconnect logic, etc.) doesn't
need to know how workers are load-balanced, and vice versa.

## `sfu` module

**Worker pool, spawned at `onModuleInit`.** One worker per CPU core: each mediasoup
worker is a separate OS process pinned to handling RTP for the routers it hosts, so
core count is the natural ceiling, not a config guess.

**Least-loaded picking, not round-robin.** Round-robin drifts unbalanced once rooms
close at different rates (a stale room on worker A ties up capacity round-robin
doesn't know about). Tracking router-count-per-worker and picking the minimum every
time keeps the pool actually balanced under real churn.

**Worker `died` exits the process.** This mirrors mediasoup's own guidance: a dead
worker (native binary crash) is not a recoverable state within the process, and
trying to patch around it (spin up a replacement worker, migrate its routers) is
more complexity than it's worth. Exiting and letting a process manager
(pm2/systemd/k8s) restart cleanly is simpler and matches how mediasoup-demo's own
production guidance reads.

**`mediaCodecs` lives in `sfu/config`, not `rooms`.** The codec list is the RTP
capability contract every router in the system shares, a property of "what this
SFU deployment supports," which is an `sfu`-module concern even though it's
consumed by `rooms` when calling `worker.createRouter({ mediaCodecs })`.

**Type note (mediasoup 3.24):** `RouterOptions.mediaCodecs` must be typed as
`RouterRtpCodecCapability[]`, not `RtpCodecCapability[]`. The latter requires
`preferredPayloadType` (used for *negotiated* codec capabilities returned during
produce/consume); the former makes it optional (used for the *declared* codec list
you hand to `createRouter`, where mediasoup assigns payload types itself). Easy to
get backwards since both come from `mediasoup/types` and look interchangeable.

**Worker teardown force-kills the OS process.** `Worker.close()` is fire-and-forget:
it notifies the mediasoup-worker process to shut down but never waits for it to
actually exit, and the process was spawned without `.unref()`. `onModuleDestroy`
follows `close()` with `process.kill(worker.pid)` so shutdown doesn't depend on the
child cooperating. Without this, every app boot/teardown cycle (e.g. repeated e2e
runs) leaks a real OS process; caught by counting orphaned `mediasoup-worker.exe`
processes after a session of test runs, confirmed by running the app standalone and
checking `process._getActiveHandles()` before and after the fix.

## `rooms` module

**`RoomsService` = `Map<roomId, Room>`.** Rooms are created lazily on first join
(no pre-provisioning step) and closed when the last peer leaves. mediasoup-demo does
the same: a room is just "a router plus whoever's connected to it," not a resource
with independent lifecycle from its occupants.

**`Room` holds one `Router` + `Map<peerId, Peer>`.** The router is fetched from
`SfuService.getWorker()` once, at room creation. A room doesn't move between
workers after creation (mediasoup doesn't support that without `pipeToRouter`
sfu-to-sfu piping, which is out of scope until there's an actual need to scale a
single room beyond one worker's capacity).

**`Peer` holds transports, producers, consumers per connection.** Two
`WebRtcTransport`s per peer (send + recv) rather than one combined transport,
matching mediasoup-demo's approach and keeping ICE renegotiation/bandwidth
estimation independent in each direction.

**`getOrCreateRoom` dedupes concurrent creation via a pending-promise map.**
Two peers joining the same brand-new roomId at the same instant would otherwise
both see no cached `Room` (neither await has resolved yet) and each create their
own `Router`, leaking one and splitting the peers across two routers that can't
route media to each other. `pendingRooms: Map<roomId, Promise<Room>>` caches the
in-flight creation itself, not just the finished result, so the second caller
gets the same promise instead of starting a second `createRouter` call. Confirmed
under real concurrent socket.io joins in the e2e suite, not just synchronous
same-tick unit calls.

## `signaling` module

Real handlers replace the generated CRUD stub (`createSignaling`/`findAllSignaling`/
etc. don't correspond to anything in this domain; signaling isn't a resource with
create/read/update/delete semantics).

**Internal layout.** `types/index.ts` (socket/session typing: `SocketContext`,
`SignalingSocketData`, `SignalingSocket`, `TransportDirection`) and
`payloads/index.ts` (one interface per WS event) are each a single file, not one
file per type: the content is small enough that splitting further would be pure
ceremony. `decorators/socket-context.decorator.ts` kept its descriptive filename
instead of becoming `decorators/index.ts`, since it's the only file there and a
generic `index.ts` name would say nothing about what it is.

Request/response handlers (client-initiated):
`getRouterRtpCapabilities`, `join`, `createWebRtcTransport`,
`connectWebRtcTransport`, `produce`, `consume`, `produceData`/`consumeData`
(if data channels are needed), pause/resume/close on producers and consumers,
`restartIce`.

Server-initiated notifications (broadcast to room):
`newPeer`, `peerClosed`, `newConsumer`, `consumerClosed`,
`consumerPaused`/`consumerResumed`, `consumerLayersChanged` (simulcast),
`activeSpeaker` (if using `AudioLevelObserver`).

**Cascade cleanup on disconnect.** Closing a peer's transports cascades to close
its producers/consumers automatically (mediasoup's own object graph handles this),
so signaling only needs to close the transports and then broadcast `peerClosed`,
not manually walk and close every producer/consumer.

**socket.io over protoo.** mediasoup-demo uses `protoo-server`/`protoo-client`
specifically for its built-in request/response + notification framing over a single
WS connection, plus reconnection support. `@nestjs/platform-socket.io` is already a
project dependency and gives equivalent request/ack + broadcast semantics via Nest's
`WebSocketGateway`, so there's no reason to add protoo as a second WS library when
socket.io covers the same shape natively within the existing stack.

**Exception handling (`src/common/ws-exception.filter.ts`).** Nest's default WS
exception handling only surfaces the real message for `WsException`; anything else,
including the `NotFoundException`s thrown throughout `SignalingService`, falls back
to a generic "Internal server error." `WsExceptionFilter` re-wraps any
`HttpException` as a `WsException` so its actual message reaches the client, while
genuinely unexpected errors stay masked (their message might leak internal details)
but are still logged server-side. Found and fixed via the e2e suite, not by
inspection.

Lives in `src/common`, not `src/signaling`, since none of this is signaling-specific.
It's applied via `@UseFilters(new WsExceptionFilter())` directly on
`SignalingGateway`, not registered globally, because `@nestjs/websockets` doesn't
support global WS filters at all: its `ExceptionFiltersContext.getGlobalMetadata()`
unconditionally returns `[]`, so neither `app.useGlobalFilters()` nor the
`APP_FILTER` DI token ever reaches a gateway (confirmed by trying both against the
e2e suite; the real error message never showed up until this got reverted back to
`@UseFilters()` on the gateway). Any future gateway needs its own `@UseFilters(new
WsExceptionFilter())` line.

**Handlers must return a non-nil ack payload.** `@nestjs/platform-socket.io` drops
any handler response that's `undefined`/`null` before it reaches the client's ack
callback. `connectWebRtcTransport` and `resumeConsumer` originally had no return
statement, so a client awaiting their ack (the same pattern every other event here
supports) hung forever with no error. Both now return a small payload
(`{ connected: true }`, `{ resumed: true }`). Also found via the e2e suite.

## Deferred until there's a concrete need

- **`pipeToRouter` / multi-worker rooms**: only matters past single-worker
  capacity for one room; premature before load-testing shows it's needed.
- **TURN/STUN config, announced IP**: required before this works outside
  localhost/LAN, but orthogonal to the module structure; slots into `sfu`'s worker
  creation options and `rooms`' `createWebRtcTransport` call whenever real network
  deployment is next.
- **Broadcaster HTTP API, recording, active-speaker detection, SVC/simulcast
  layer control**: demo features not required for a minimal working room; add
  once core produce/consume path is proven.

## Test strategy (why this split, not just what)

Three tiers, chosen so the expensive/flaky layer is only exercised for what nothing
else can prove:

- **Unit**: `sfu`'s worker-picker, `rooms`' state machine (join/leave/room-empty),
  signaling's message dispatch, all mockable, no real mediasoup process needed.
  Fast, so this is where join/leave edge cases and malformed-input handling get
  covered exhaustively.
- **E2E (real app, real mediasoup, no browser)**: a real NestJS app with real
  mediasoup workers/routers, driven by real socket.io clients. Fabricated (but
  syntactically valid) dtlsParameters stand in for a browser's real ICE/DTLS
  negotiation, since `connectWebRtcTransport`/`produce`/`consume` are pure
  signaling RPCs that don't block on actual connectivity. This is what actually
  caught the two bugs above: both were invisible to unit tests since they only
  surface once a real socket.io adapter is in the loop.
- **Browser e2e**: deferred; not implemented, since this repo has no client to
  drive. Would be the only tier able to prove actual ICE/DTLS negotiation,
  simulcast layer switching under real network throttling, and multi-tab UX
  flows (mute reflected remotely, screen-share add/remove, leave cleanup).
