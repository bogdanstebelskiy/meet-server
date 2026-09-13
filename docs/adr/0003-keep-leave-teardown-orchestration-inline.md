# Keep peer-departure teardown orchestration inline in `SignalingService.leave()`

An architecture review flagged `SignalingService.leave()` (`apps/realtime/src/signaling/signaling.service.ts`) as a candidate to extract: it inline-orchestrates a 6-step cross-app teardown cascade (`RoomsService.removePeer`, `SfuClientService.removePeer`, an empty-room check, `RoomsService.closeRoom`, `SfuClientService.closeRoom`, `ChatService.deleteRoomHistory`) alongside `SignalingService`'s other WS-handler concerns (`join`, `produce`, `consume`, etc.).

Rejected for now: `leave()` has exactly one caller, `SignalingGateway.handleDisconnect`. No second caller exists or is tracked in the issue tracker — a peer-liveness/reaping mechanism (for a peer that vanishes without a clean disconnect) has no issue yet and is explicitly *not* what issue #7 covers (#7 is `Session`, the Room→sfu-instance sticky-routing TTL, not peer liveness — see `CONTEXT.md`'s `Session` "Avoid" note). Per this codebase's own architecture-review heuristic, one caller is a hypothetical seam, not a real one; extracting a dedicated module now would be building reuse for a caller that doesn't exist.

## Consequences

Revisit this once a second caller of the same teardown sequence actually lands (e.g. a peer-liveness/reaping mechanism gets its own issue and needs to trigger the same cascade outside of `handleDisconnect`) — at that point the "two adapters = real seam" condition is met and extraction is worth doing.
