import type { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => new Redis(redisUrl, { password: process.env.REDIS_AUTH }),
};
