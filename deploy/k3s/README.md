# k3s deployment

Manifests for running `meet-server` on a k3s cluster.

## Deploy

```bash
kubectl apply -f 00-namespace.yaml
kubectl apply -f 05-sfu-node-config.yaml   # generated, see below
kubectl apply -f 10-redis.yaml
kubectl apply -f 20-sfu.yaml
kubectl apply -f 30-realtime.yaml
```

## Images

The manifests reference `meet-sfu:local` and `meet-realtime:local` with
`imagePullPolicy: Never`, built and imported into the cluster directly:

```bash
docker build -f apps/sfu/Dockerfile -t meet-sfu:local .
docker build -f apps/realtime/Dockerfile -t meet-realtime:local .
docker save meet-sfu:local | sudo k3s ctr images import -
docker save meet-realtime:local | sudo k3s ctr images import -
```

To pull from GHCR instead (CI already publishes there, see root
`CLAUDE.md`), change both `image:` fields to
`ghcr.io/<owner>/meet-sfu`/`meet-realtime` and `imagePullPolicy` to
`IfNotPresent`.

## `05-sfu-node-config.yaml`

Not checked in. It holds one cluster-specific value: the node's real,
publicly reachable IP that mediasoup announces in ICE candidates
(`WEBRTC_ANNOUNCED_ADDRESS`, see
`apps/sfu/src/config/webrtc-config.service.ts`). It can never be
`127.0.0.1` or `0.0.0.0` if cross-device calls need to work.

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: sfu-node-config
  namespace: meet
data:
  announcedAddress: "<node's public IP>"
EOF
```

## `meet-tls`

TLS secret for the `Ingress` in `30-realtime.yaml`. Use cert-manager and a
real domain in production; for a quick self-signed cert:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/meet-tls.key -out /tmp/meet-tls.crt \
  -subj "/CN=meet.local"
kubectl -n meet create secret tls meet-tls \
  --cert=/tmp/meet-tls.crt --key=/tmp/meet-tls.key
```
