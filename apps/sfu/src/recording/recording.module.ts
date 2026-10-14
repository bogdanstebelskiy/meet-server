import { Module } from '@nestjs/common';
import { RecordingConfigService } from '../config/recording-config.service';
import { RecordingService } from './recording.service';

@Module({
  providers: [RecordingService, RecordingConfigService],
  exports: [RecordingService],
})
export class RecordingModule {}
