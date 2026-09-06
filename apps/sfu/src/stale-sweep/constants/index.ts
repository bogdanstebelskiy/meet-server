// Realtime's own peer-liveness/session TTLs (apps/realtime/src/rooms and
// sessions constants) are 30s, continuously refreshed while a call is
// alive - this default clears that by a wide margin so an occasional
// produce/consume gap during a genuinely active call never trips the sweep.
export const DEFAULT_STALE_ROOM_THRESHOLD_MS = 30 * 60 * 1000;
export const DEFAULT_STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
