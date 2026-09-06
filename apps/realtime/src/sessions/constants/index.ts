export const SESSION_KEY_PREFIX = 'session:';

// Matches apps/sfu's INSTANCE_KEY_PREFIX (instance-registry/constants) - the
// two apps agree on this Redis key format, not shared code.
export const INSTANCE_KEY_PREFIX = 'sfu:instance:';

// Just long enough to dedupe a burst of concurrent reassignment attempts from
// the same incident (issue #34's recovery) - reassignment itself is a single
// REST call plus a few Redis writes, so this isn't meant to hold across a
// whole outage.
export const SESSION_LOCK_TTL_SECONDS = 10;
