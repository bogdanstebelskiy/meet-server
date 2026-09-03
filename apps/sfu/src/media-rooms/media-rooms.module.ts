import { Module } from '@nestjs/common';
import { WorkersModule } from '../workers/workers.module';
import { WebRtcConfigService } from '../config/webrtc-config.service';
import { MediaRoomsService } from './media-rooms.service';
import { MediaRoomsController } from './media-rooms.controller';

@Module({
  imports: [WorkersModule],
  controllers: [MediaRoomsController],
  providers: [MediaRoomsService, WebRtcConfigService],
})
export class MediaRoomsModule {}
