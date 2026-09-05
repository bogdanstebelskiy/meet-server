import { Module } from '@nestjs/common';
import { REDIS_CLIENT, redisProvider } from './redis.provider';
import { RedisConfigService } from '../config/redis-config.service';

@Module({
  providers: [redisProvider, RedisConfigService],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
