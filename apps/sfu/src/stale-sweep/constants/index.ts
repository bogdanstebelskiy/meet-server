// A live call can go quiet at the REST layer for a long stretch with no
// produce/consume/pause-resume activity at all (steady audio/video, nobody
// muting or joining) - there's no periodic touch from realtime to lean on
// (issue #34 removed sessionHeartbeat, and Session's own TTL now only
// refreshes on join, not continuously). So this can't be tuned to a short
// window without risking closing a genuinely active room; matching
// realtime's own Room TTL (apps/realtime/src/rooms/constants: 24h) keeps
// this sweep the same order-of-magnitude backstop for an abandoned room,
// not a tighter one that fires under ordinary quiet use.
export const DEFAULT_STALE_ROOM_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STALE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
