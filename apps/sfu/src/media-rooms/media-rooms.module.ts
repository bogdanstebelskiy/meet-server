import { Module } from '@nestjs/common';
import { WorkersModule } from '../workers/workers.module';
import { RecordingModule } from '../recording/recording.module';
import { WebRtcConfigService } from '../config/webrtc-config.service';
import { MediaCodecsConfigService } from '../config/media-codecs-config.service';
import { MediaRoomsService } from './media-rooms.service';
import { MediaRoomsController } from './media-rooms.controller';

@Module({
  imports: [WorkersModule, RecordingModule],
  controllers: [MediaRoomsController],
  providers: [MediaRoomsService, WebRtcConfigService, MediaCodecsConfigService],
})
export class MediaRoomsModule {}
