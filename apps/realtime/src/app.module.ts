import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomsModule } from './rooms/rooms.module';
import { SignalingModule } from './signaling/signaling.module';
import { ChatModule } from './chat/chat.module';
import { ChatGateway } from './chat/chat.gateway';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RoomsModule, SignalingModule, ChatModule],
  controllers: [AppController],
  providers: [AppService, ChatGateway],
})
export class AppModule {}
