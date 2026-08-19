import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomsModule } from './rooms/rooms.module';
import { SignalingModule } from './signaling/signaling.module';
import { SfuModule } from './sfu/sfu.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RoomsModule,
    SignalingModule,
    SfuModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
