# sfu horizontal-scaling load test

Reproduces the load test that measured how much `apps/realtime` + `apps/sfu`'s
capacity increases with sfu replicas. Not part of the shipped apps - standalone
tooling, its own `package.json`/`node_modules`.

## What it tests, and why it's built this way

This measures **signaling-layer capacity** (room creation, transport/producer/
consumer churn across sfu replicas) - not raw per-participant media-encode
cost. `signal-bots.ts` drives `apps/realtime`'s socket.io API directly: no
browser, no frontend, no Clerk auth. Two things make that valid:

- `connectWebRtcTransport`/`produce`/`consume` are pure signaling RPCs that
  don't need real ICE/DTLS to succeed (same trick `apps/realtime`'s own e2e
  suite uses - see `docs/sfu-signaling-design.md`).
- `apps/realtime`'s `SignalingGateway` has no auth check at all; Clerk is
  enforced only by the Next.js frontend's middleware, a layer this test
  never goes through.

Everything runs in Docker containers, not native processes, for two reasons:

- **CPU isolation**: `--cpuset-cpus` is real kernel-enforced cgroups affinity.
  A native-Windows equivalent was tried first (`Process.ProcessorAffinity`)
  and confirmed *not* to propagate to child processes (mediasoup workers,
  browser renderers) - Chrome ran on all cores regardless of the mask set on
  its launching process. cgroups doesn't have that problem.
- **Avoids loopback TCP exhaustion**: driving thousands of connections
  natively on Windows against a process on the same machine burns through
  the loopback TCP stack's TIME_WAIT/ephemeral-port budget - confirmed by
  testing (failure rate got *worse* across repeated runs, independent of
  process count or TLS). Containers put this traffic on Docker Desktop's
  Linux VM's network stack instead, which doesn't hit that ceiling.

`os.cpus()` inside a `--cpuset-cpus`-limited container still reports the
*host's* full core count, not the container's allocation - confirmed live
(a container capped to 4 cores spawned 22 mediasoup workers). That's what
`SFU_WORKER_POOL_SIZE` (`apps/sfu`) is for; the script always sets it to
match each replica's cpuset.

## Prerequisites

- Docker Desktop with a Linux container backend (WSL2) - `docker info` should
  report `OSType: linux`.
- Bash (Git Bash on Windows is fine - this is what it was built and run with).

## Running it

```bash
cd load-test
npm install   # only needed once, for local type-checking - the bots run in a container

./run-load-test.sh [REPLICA_COUNT] [BOT_CONTAINERS] [ROOMS_PER_CONTAINER] [PEERS_PER_ROOM]

# The comparison this was built for - run once each way and compare "succeeded":
./run-load-test.sh 1 20 125 4   # 1 replica,  10000 simulated peers
./run-load-test.sh 2 20 125 4   # 2 replicas, same 10000 simulated peers
```

Defaults: 1 replica, 20 bot containers x 125 rooms x 4 peers/room. `CORES_PER_REPLICA`
(default 4) and `HOLD_SECONDS` (default 15, how long joined peers stay
connected before a graceful staggered disconnect) are env vars, e.g.
`CORES_PER_REPLICA=6 ./run-load-test.sh 2`.

Core layout is computed from `docker info`'s reported core count, not
hardcoded: 2 reserved, 2 for realtime, `REPLICA_COUNT x CORES_PER_REPLICA`
for sfu (starting right after realtime's), and a fixed 6 for the bot
containers at the top of the range - the same budget regardless of replica
count, so only the sfu side of the comparison changes between runs. The
script exits with a clear error before touching anything if the requested
replica count/cores don't fit.

The script builds `apps/realtime`/`apps/sfu`'s existing Dockerfiles plus its
own `Dockerfile.bots`, creates an isolated `meet-loadtest` network, runs
everything on it, and tears down on exit (success or failure) via a trap -
images are left built (layer-cached, so reruns are fast); nothing else
persists.

## What we actually found

At 10,000 simulated peers (2,500 rooms x 4 peers), all failures being
`createWebRtcTransport timed out` (a genuine capacity signal, not an
infrastructure artifact):

| Replicas | Succeeded | Failed | Success rate |
|---|---|---|---|
| 1 (4 cores) | 6,361 | 3,639 | 63.6% |
| 2 (4 cores each) | 9,998 | 2 | 99.98% |

## Known gap found along the way (not fixed here)

A large simultaneous disconnect burst can outrun `SignalingService.leave()`'s
fire-and-forget sfu teardown call (`apps/realtime/src/signaling/signaling.service.ts`),
leaving orphaned `MediaRoom`s on sfu that nothing ever retries - confirmed at
scale (843 rooms stuck after one native test's bot process exited all at
once). `signal-bots.ts` works around this for its own teardown (batched,
staggered `socket.disconnect()` calls, not a synchronous mass-exit), but the
underlying gap in `apps/realtime` is real and unaddressed.
