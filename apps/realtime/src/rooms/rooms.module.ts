import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { SfuClientModule } from '../sfu-client/sfu-client.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [SfuClientModule, RedisModule],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
