import { Module } from '@nestjs/common';
import { SignalingService } from './signaling.service';
import { SignalingGateway } from './signaling.gateway';
import { RoomsModule } from '../rooms/rooms.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [RoomsModule, ChatModule],
  providers: [SignalingGateway, SignalingService],
})
export class SignalingModule {}
