import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { RedisModule } from '../redis/redis.module';
import { SfuConfigService } from '../config/sfu-config.service';

@Module({
  imports: [RedisModule],
  providers: [SessionsService, SfuConfigService],
  exports: [SessionsService],
})
export class SessionsModule {}
