// Well under PEER_LIVENESS_TTL_SECONDS (rooms/constants) so a single missed
// tick never expires a still-connected peer.
export const PEER_LIVENESS_REFRESH_INTERVAL_MS = 10_000;
