import type { Redis, Result } from 'ioredis';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    closeRoomIfEmpty(
      peersKey: string,
      roomKey: string,
    ): Result<number, Context>;
  }
}

// Inlined rather than read from a .lua file - the realtime project's
// webpack builder doesn't copy non-TS assets into dist (nest-cli.json's
// "assets" entry is a no-op under webpack), so a separate file never made
// it to the built output.
// KEYS[1] = peersKey, KEYS[2] = roomKey. Atomic so a concurrent addPeer
// can't land between the emptiness check and the delete (issue #24).
const CLOSE_ROOM_IF_EMPTY_SCRIPT = `
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

export function registerRedisScripts(redis: Redis): void {
  redis.defineCommand('closeRoomIfEmpty', {
    lua: CLOSE_ROOM_IF_EMPTY_SCRIPT,
    numberOfKeys: 2,
  });
}
