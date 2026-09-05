import { Logger, type Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisConfigService } from '../config/redis-config.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const logger = new Logger('InstanceRegistryRedis');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (redisConfig: RedisConfigService) => {
    // lazyConnect - skip opening a connection when the heartbeat is disabled.
    const redis = new Redis(redisConfig.url, {
      password: redisConfig.auth,
      lazyConnect: true,
    });

    // Unhandled 'error' events crash the process - Redis is best-effort here.
    redis.on('error', (error) => {
      logger.error('Instance registry Redis connection error', error);
    });

    return redis;
  },
  inject: [RedisConfigService],
};
