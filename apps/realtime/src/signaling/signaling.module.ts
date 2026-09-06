import { Module } from '@nestjs/common';
import { SignalingService } from './signaling.service';
import { SignalingGateway } from './signaling.gateway';
import { RoomsModule } from '../rooms/rooms.module';
import { ChatModule } from '../chat/chat.module';
import { SfuClientModule } from '../sfu-client/sfu-client.module';
import { SessionsModule } from '../sessions/sessions.module';
import { BroadcastModule } from '../broadcast/broadcast.module';

@Module({
  imports: [
    RoomsModule,
    ChatModule,
    SfuClientModule,
    SessionsModule,
    BroadcastModule,
  ],
  providers: [SignalingGateway, SignalingService],
})
export class SignalingModule {}
