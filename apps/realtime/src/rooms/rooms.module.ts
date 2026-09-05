import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { SfuClientModule } from '../sfu-client/sfu-client.module';
import { RedisModule } from '../redis/redis.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [SfuClientModule, RedisModule, SessionsModule],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
