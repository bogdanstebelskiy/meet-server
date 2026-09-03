import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { RedisModule } from '../redis/redis.module';
import { RoomsModule } from '../rooms/rooms.module';

@Module({
  imports: [RedisModule, RoomsModule],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
