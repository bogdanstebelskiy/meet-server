import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.provider';
import { InstanceRegistryConfigService } from './config/instance-registry-config.service';
import { MediaRoomsService } from '../media-rooms/media-rooms.service';
import { INSTANCE_KEY_PREFIX } from './constants';
import type { InstanceRecord } from './types';

@Injectable()
export class InstanceRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceRegistryService.name);
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly instanceRegistryConfig: InstanceRegistryConfigService,
    private readonly mediaRoomsService: MediaRoomsService,
  ) {}

  onModuleInit(): void {
    const advertisedUrl = this.instanceRegistryConfig.advertisedUrl;

    if (!advertisedUrl) {
      this.logger.warn(
        'SFU_ADVERTISED_URL not set - this instance will not publish load/health to Redis',
      );
      return;
    }

    const intervalMs = this.instanceRegistryConfig.heartbeatIntervalMs;

    // Publish immediately too - a fresh instance shouldn't be invisible for a whole interval.
    this.tick(advertisedUrl);
    this.interval = setInterval(() => this.tick(advertisedUrl), intervalMs);
  }

  private tick(advertisedUrl: string): void {
    this.publishHeartbeat(advertisedUrl).catch((error) =>
      this.logger.error(
        `Failed to publish instance heartbeat for ${advertisedUrl}`,
        error,
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }

    const advertisedUrl = this.instanceRegistryConfig.advertisedUrl;

    if (advertisedUrl) {
      try {
        const key = this.instanceKey(advertisedUrl);
        await this.redis.del(key);
      } catch (error) {
        this.logger.error(
          `Failed to remove instance record for ${advertisedUrl}`,
          error,
        );
      }
    }

    // Stops a retrying-unreachable-Redis client from outliving shutdown.
    this.redis.disconnect();
  }

  private async publishHeartbeat(advertisedUrl: string): Promise<void> {
    const record: InstanceRecord = {
      load: this.mediaRoomsService.getTotalConsumerCount(),
      updatedAt: new Date().toISOString(),
    };

    const key = this.instanceKey(advertisedUrl);
    const value = JSON.stringify(record);
    const ttlSeconds = this.instanceRegistryConfig.ttlSeconds;

    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  private instanceKey(advertisedUrl: string): string {
    return `${INSTANCE_KEY_PREFIX}${advertisedUrl}`;
  }
}
