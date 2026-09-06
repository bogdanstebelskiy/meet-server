import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { SfuConfigService } from '../config/sfu-config.service';
import { ROOM_TTL_SECONDS } from '../rooms/constants';
import { INSTANCE_KEY_PREFIX, SESSION_KEY_PREFIX } from './constants';
import type { InstanceEntry, InstanceRecord } from './types';

@Injectable()
export class SessionsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sfuConfig: SfuConfigService,
  ) {}

  async assign(roomId: string): Promise<string> {
    const instanceUrl = await this.pickInstance();
    const sessionKey = this.sessionKey(roomId);
    await this.redis.set(sessionKey, instanceUrl, 'EX', ROOM_TTL_SECONDS);

    return instanceUrl;
  }

  async get(roomId: string): Promise<string | undefined> {
    const sessionKey = this.sessionKey(roomId);
    const instanceUrl = await this.redis.get(sessionKey);

    if (instanceUrl) {
      return instanceUrl;
    }
  }

  // Shares Room's own TTL and refresh trigger (getOrCreateRoom's
  // existing-room branch, rooms.service.ts) instead of a separate, shorter
  // TTL kept alive by a dedicated heartbeat - issue #34.
  async touch(roomId: string): Promise<void> {
    const sessionKey = this.sessionKey(roomId);
    await this.redis.expire(sessionKey, ROOM_TTL_SECONDS);
  }

  async invalidate(roomId: string): Promise<void> {
    const sessionKey = this.sessionKey(roomId);
    await this.redis.del(sessionKey);
  }

  // No live instances registered (single-fixed-instance setups, e2e) falls
  // back to the configured SFU_SERVICE_URL, same target every call would
  // have hit before sessions existed.
  private async pickInstance(): Promise<string> {
    const instances = await this.listInstances();

    if (instances.length === 0) {
      return this.sfuConfig.serviceUrl;
    }

    const sortedInstances = [...instances].sort((a, b) => a.load - b.load);
    const [leastLoaded] = sortedInstances;

    return leastLoaded.url;
  }

  private async listInstances(): Promise<InstanceEntry[]> {
    const keys = await this.scanInstanceKeys();

    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(...keys);
    const parsedEntries = keys.map((key, index) =>
      this.parseInstance(key, values[index]),
    );
    const instances = parsedEntries.filter(
      (entry): entry is InstanceEntry => entry !== undefined,
    );

    return instances;
  }

  private async scanInstanceKeys(): Promise<string[]> {
    const pattern = `${INSTANCE_KEY_PREFIX}*`;
    const stream = this.redis.scanStream({ match: pattern, count: 100 });
    const keys: string[] = [];

    for await (const batch of stream as AsyncIterable<string[]>) {
      keys.push(...batch);
    }

    return keys;
  }

  private parseInstance(
    key: string,
    raw: string | null,
  ): InstanceEntry | undefined {
    if (!raw) {
      return;
    }

    const record = JSON.parse(raw) as InstanceRecord;
    const url = key.slice(INSTANCE_KEY_PREFIX.length);

    return { url, load: record.load };
  }

  private sessionKey(roomId: string): string {
    return `${SESSION_KEY_PREFIX}${roomId}`;
  }
}
