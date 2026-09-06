import { Module } from '@nestjs/common';
import { MediaRoomsModule } from '../media-rooms/media-rooms.module';
import { StaleSweepConfigService } from './config/stale-sweep-config.service';
import { StaleSweepService } from './stale-sweep.service';

@Module({
  imports: [MediaRoomsModule],
  providers: [StaleSweepConfigService, StaleSweepService],
})
export class StaleSweepModule {}
