# Externalize Room/Peer state to Redis, making Redis a hard dependency for signaling

Issue #6 needs `apps/realtime` to scale horizontally: today `RoomsService`'s `Room`/`Peer` state is a plain in-process `Map`, so a client's `join`/`produce`/`consume` calls only work if they land on the one instance holding that room's state, and any broadcast (`newPeer`, `newProducer`, `peerClosed`) only reaches sockets connected to that same process. We're moving `Room`/`Peer` state into Redis (a hash per room for peers, a hash per peer for producers) and adding the official `@socket.io/redis-adapter` for cross-instance broadcast, so any `realtime` instance can serve any room and see any peer.

## Considered options

- **Sticky routing instead of shared state** (route a room's traffic to whichever instance created it, like `apps/sfu` will eventually need for mediasoup routers). Rejected: `realtime` holds no resource as expensive as a mediasoup `Router` — membership state is cheap to share centrally, so sticky routing would trade away load-balancer simplicity for no real benefit here.
- **Keep Redis optional, degrade gracefully on outage** (mirroring today's chat behavior, which just logs errors and keeps serving). Rejected as impractical: unlike chat history, room membership is load-bearing for every signaling operation — there's no meaningful "degraded" mode for `join`/`produce` without the data that identifies who's in the room.

## Consequences

Redis changes from an optional dependency (today, only `chat` degrades if it's unreachable) to a hard one: if Redis is down, all of `join`/`produce`/`consume`/etc. fail, not just chat history. This is a deliberate trade — a new single point of failure accepted in exchange for removing the old one (a single `realtime` instance holding all room state in memory, unreachable by any other instance). Making Redis itself highly available (cluster/sentinel) is out of scope for #6.
