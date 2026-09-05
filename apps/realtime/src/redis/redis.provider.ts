import type { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { registerRedisScripts } from './redis-scripts';
import { RedisConfigService } from '../config/redis-config.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (redisConfig: RedisConfigService) => {
    const redis = new Redis(redisConfig.url, { password: redisConfig.auth });
    registerRedisScripts(redis);
    return redis;
  },
  inject: [RedisConfigService],
};
