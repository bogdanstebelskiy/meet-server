#!/usr/bin/env bash
# Reproduces the containerized sfu-replica load test: builds real
# apps/realtime + apps/sfu images, runs N sfu replicas + one realtime
# instance on a dedicated Docker network with real cgroups CPU pinning
# (--cpuset-cpus - reliable, unlike per-process affinity on Windows), then
# drives BOT_CONTAINERS separate signal-bots.ts containers at the signaling
# layer directly (no browser, no frontend, no Clerk - apps/realtime's WS
# gateway has no auth check, and produce/consume/connectWebRtcTransport are
# pure signaling RPCs that don't need real ICE/DTLS to succeed).
#
# Why containers, not native processes: running the load generator natively
# on Windows against a native realtime/sfu exhausts the loopback TCP stack's
# TIME_WAIT/ephemeral-port budget under high connection churn (confirmed:
# it caused most of one run's connections to fail, worse across repeated
# runs, regardless of process count or TLS). Containers put this traffic on
# Docker Desktop's Linux VM's network stack instead, which doesn't have
# that problem - and --cpuset-cpus is real kernel-enforced cgroups affinity,
# not the Windows Job Object workaround this session's native scripts needed.
#
# Usage:
#   ./run-load-test.sh [REPLICA_COUNT] [BOT_CONTAINERS] [ROOMS_PER_CONTAINER] [PEERS_PER_ROOM]
#
# Example - the comparison this was built for (run once each way):
#   ./run-load-test.sh 1 20 125 4   # 1 replica,  10000 simulated peers
#   ./run-load-test.sh 2 20 125 4   # 2 replicas, same 10000 simulated peers
#
# Requires Docker Desktop with a Linux container backend (WSL2), running
# from a shell in this directory or anywhere - paths are resolved relative
# to this script.
set -euo pipefail

REPLICA_COUNT="${1:-1}"
BOT_CONTAINERS="${2:-20}"
ROOMS_PER_CONTAINER="${3:-125}"
PEERS_PER_ROOM="${4:-4}"
CORES_PER_REPLICA="${CORES_PER_REPLICA:-4}"
HOLD_SECONDS="${HOLD_SECONDS:-15}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NETWORK="meet-loadtest"
TOTAL_PEERS=$((BOT_CONTAINERS * ROOMS_PER_CONTAINER * PEERS_PER_ROOM))

TOTAL_CORES="$(docker info --format '{{.NCPU}}')"
REALTIME_CORES=2
BOT_CORES=6
SFU_CORES_NEEDED=$((REPLICA_COUNT * CORES_PER_REPLICA))
RESERVED_CORES=2
MIN_CORES_NEEDED=$((RESERVED_CORES + REALTIME_CORES + SFU_CORES_NEEDED + BOT_CORES))
if [ "$MIN_CORES_NEEDED" -gt "$TOTAL_CORES" ]; then
  echo "Need $MIN_CORES_NEEDED cores (2 reserved + $REALTIME_CORES realtime + $SFU_CORES_NEEDED sfu + $BOT_CORES bots), Docker only reports $TOTAL_CORES. Lower REPLICA_COUNT/CORES_PER_REPLICA." >&2
  exit 1
fi

REALTIME_CPUSET="$RESERVED_CORES-$((RESERVED_CORES + REALTIME_CORES - 1))"
SFU_FIRST_CORE=$((RESERVED_CORES + REALTIME_CORES))
BOT_FIRST_CORE=$((TOTAL_CORES - BOT_CORES))
BOT_CPUSET="$BOT_FIRST_CORE-$((TOTAL_CORES - 1))"

echo "=== meet-server sfu load test ==="
echo "replicas=$REPLICA_COUNT x ${CORES_PER_REPLICA} cores | bot containers=$BOT_CONTAINERS x $ROOMS_PER_CONTAINER rooms x $PEERS_PER_ROOM peers = $TOTAL_PEERS simulated peers"
echo "cores: realtime=$REALTIME_CPUSET sfu starts at core $SFU_FIRST_CORE bots=$BOT_CPUSET (of $TOTAL_CORES total)"

cleanup() {
  echo "--- tearing down ---"
  # shellcheck disable=SC2046
  docker rm -f $(docker ps -aq --filter "network=$NETWORK" 2>/dev/null) >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker network create "$NETWORK" >/dev/null

echo "--- building images ---"
docker build -q -f "$REPO_ROOT/apps/realtime/Dockerfile" -t meet-realtime:loadtest "$REPO_ROOT" >/dev/null
docker build -q -f "$REPO_ROOT/apps/sfu/Dockerfile" -t meet-sfu:loadtest "$REPO_ROOT" >/dev/null
docker build -q -f "$SCRIPT_DIR/Dockerfile.bots" -t meet-loadtest-bots "$SCRIPT_DIR" >/dev/null

echo "--- starting redis ---"
docker run -d --name redis --network "$NETWORK" redis:7-alpine >/dev/null

SFU_URLS=()
for ((i = 0; i < REPLICA_COUNT; i++)); do
  core_start=$((SFU_FIRST_CORE + i * CORES_PER_REPLICA))
  core_end=$((core_start + CORES_PER_REPLICA - 1))
  echo "--- starting sfu-$i (cores $core_start-$core_end) ---"
  docker run -d --name "sfu-$i" --network "$NETWORK" \
    --cpuset-cpus "$core_start-$core_end" \
    -e SFU_WORKER_POOL_SIZE="$CORES_PER_REPLICA" \
    meet-sfu:loadtest >/dev/null
  SFU_URLS+=("http://sfu-$i:3000")
done
SFU_URLS_JOINED="$(IFS=,; echo "${SFU_URLS[*]}")"

echo "--- starting realtime (cores $REALTIME_CPUSET) ---"
docker run -d --name realtime --network "$NETWORK" \
  --cpuset-cpus "$REALTIME_CPUSET" \
  -e REDIS_URL=redis://redis:6379 \
  -e SFU_SERVICE_URLS="$SFU_URLS_JOINED" \
  meet-realtime:loadtest >/dev/null

sleep 3

echo "--- launching $BOT_CONTAINERS bot containers (cores $BOT_CPUSET) ---"
BOT_NAMES=()
for ((i = 1; i <= BOT_CONTAINERS; i++)); do
  name="bots-$i"
  docker run -d --name "$name" --network "$NETWORK" \
    --cpuset-cpus "$BOT_CPUSET" \
    -e LOAD_TEST_SIGNALING_URL=http://realtime:3000 \
    meet-loadtest-bots "run-$i" "$ROOMS_PER_CONTAINER" "$PEERS_PER_ROOM" "$HOLD_SECONDS" >/dev/null
  BOT_NAMES+=("$name")
done

echo "--- waiting for all bot containers to finish ---"
docker wait "${BOT_NAMES[@]}" >/dev/null

TOTAL_SUCCEEDED=0
TOTAL_FAILED=0
for name in "${BOT_NAMES[@]}"; do
  line="$(docker logs "$name" 2>&1 | grep '^{' || true)"
  if [ -z "$line" ]; then
    echo "  $name: no result line (crashed before reporting - check 'docker logs $name' before teardown)"
    continue
  fi
  succeeded="$(echo "$line" | sed -E 's/.*"succeeded":([0-9]+).*/\1/')"
  failed="$(echo "$line" | sed -E 's/.*"failed":([0-9]+).*/\1/')"
  TOTAL_SUCCEEDED=$((TOTAL_SUCCEEDED + succeeded))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))
done

echo "=== result ==="
echo "replicas=$REPLICA_COUNT total_peers=$TOTAL_PEERS succeeded=$TOTAL_SUCCEEDED failed=$TOTAL_FAILED"
