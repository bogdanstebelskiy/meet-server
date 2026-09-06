export const RECOVERY_LOCK_KEY_PREFIX = 'recovery:';

// Just long enough to dedupe a burst of concurrent failures from the same
// incident - recovery itself is a single REST call plus a few Redis writes,
// so this isn't meant to hold across a whole outage.
export const RECOVERY_LOCK_TTL_SECONDS = 10;

export const ROOM_RECOVERED_EVENT = 'roomRecovered';
