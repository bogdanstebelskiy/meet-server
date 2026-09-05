# Route to a specific sfu instance directly, never through a load balancer or gateway

`apps/sfu` instances are stateful in a way `apps/realtime` instances are not: a mediasoup `Router`/`MediaRoom` is pinned to the one process that created it and never migrates (`docs/sfu-signaling-design.md`). Issue #7's Session (`CONTEXT.md`) exists precisely because a room's REST calls must always reach the *same* sfu instance, chosen once at session-create. `apps/realtime` will dial that instance directly by its advertised address, read from the registry #8 maintains in Redis (instance URL, load, health) — never through an intermediary that could route a room's later calls somewhere else.

## Considered options

- **A load balancer / API gateway in front of sfu instances**, using L7 session affinity (e.g. Envoy/Istio consistent-hash on a `roomId` header) to keep a room's traffic pinned to one backend. Rejected:
  - Doesn't solve the *initial* assignment problem — picking the least-loaded instance for a brand-new room still needs instances broadcasting load somewhere (i.e. #8 has to exist regardless, making the LB pure redundant overhead).
  - Consistent/ring hashing minimizes rehashing on topology change but doesn't eliminate it — adding or removing an sfu instance can still remap an *existing* room to a different backend. For a stateless resource that's a shrug; for a `Router` pinned to one process's memory, a rehash means the room's state silently doesn't exist on the new target.
  - The media plane already can't go through a gateway at all — client ICE/RTP connects directly to a specific pod's UDP/TCP port range (`hostNetwork` or per-pod addressing, per #30). Routing the REST control plane through a *different* mechanism (LB affinity) than the media plane (direct per-pod address) would mean tracking "which instance owns this room" two separate ways for no benefit.
- **A shared/standard k8s Service (ClusterIP) in front of sfu pods.** Rejected for the same reason: a Service is itself a load-balancing abstraction (kube-proxy round-robins), which reintroduces the exact problem above. Each instance needs individually-addressable identity (a headless Service's per-pod DNS name, or the same `hostNetwork`/pod-IP approach #30 already proposes for media) — not a VIP.

## Consequences

Every sfu instance must publish its own externally-reachable REST base URL (a new `SFU_ADVERTISED_URL`-style env var, mirroring how `WEBRTC_ANNOUNCED_ADDRESS` already solves the same problem for media), and that address must resolve to one specific process — never a load-balanced endpoint. `apps/realtime` becomes responsible for routing decisions that would normally be an infrastructure concern; this is a deliberate trade of infra simplicity for correctness on a resource that can't tolerate being load-balanced.
