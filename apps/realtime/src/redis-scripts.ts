import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Redis, Result } from 'ioredis';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    closeRoomIfEmpty(
      peersKey: string,
      roomKey: string,
    ): Result<number, Context>;
  }
}

// Lives at src root, not inside rooms/, so this path also resolves once
// webpack bundles everything into one dist/apps/realtime file (nest-cli.json
// copies .lua files there too - see its "assets" entry).
function readScript(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, fileName), 'utf8');
}

// Add new scripts here: one .lua file (matched by nest-cli.json's "*.lua"
// asset glob, no config change needed) plus one defineCommand call below.
export function registerRedisScripts(redis: Redis): void {
  redis.defineCommand('closeRoomIfEmpty', {
    lua: readScript('close-room-if-empty.lua'),
    numberOfKeys: 2,
  });
}
