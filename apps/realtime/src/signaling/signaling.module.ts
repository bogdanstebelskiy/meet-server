import { Module } from '@nestjs/common';
import { SignalingService } from './signaling.service';
import { SignalingGateway } from './signaling.gateway';
import { RoomsModule } from '../rooms/rooms.module';
import { ChatModule } from '../chat/chat.module';
import { SfuClientModule } from '../sfu-client/sfu-client.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [RoomsModule, ChatModule, SfuClientModule, SessionsModule],
  providers: [SignalingGateway, SignalingService],
})
export class SignalingModule {}
