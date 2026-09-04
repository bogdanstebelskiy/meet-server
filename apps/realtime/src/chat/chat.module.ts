import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
