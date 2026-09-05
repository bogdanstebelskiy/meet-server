export const SESSION_KEY_PREFIX = 'session:';
export const SESSION_TTL_SECONDS = 30;
export const SESSION_TOUCH_DEBOUNCE_MS = 10_000;

// Matches apps/sfu's INSTANCE_KEY_PREFIX (instance-registry/constants) - the
// two apps agree on this Redis key format, not shared code.
export const INSTANCE_KEY_PREFIX = 'sfu:instance:';
