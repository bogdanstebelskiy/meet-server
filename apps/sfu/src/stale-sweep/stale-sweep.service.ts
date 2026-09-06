import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MediaRoomsService } from '../media-rooms/media-rooms.service';
import { StaleSweepConfigService } from './config/stale-sweep-config.service';

@Injectable()
export class StaleSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleSweepService.name);
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly mediaRoomsService: MediaRoomsService,
    private readonly staleSweepConfig: StaleSweepConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.staleSweepConfig.sweepIntervalMs;
    this.interval = setInterval(() => this.tick(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private tick(): void {
    const thresholdMs = this.staleSweepConfig.thresholdMs;
    const closedRoomIds = this.mediaRoomsService.closeStaleRooms(thresholdMs);

    if (closedRoomIds.length === 0) {
      return;
    }

    this.logger.warn(
      `Closed ${closedRoomIds.length} stale MediaRoom(s) with no REST activity: ${closedRoomIds.join(', ')}`,
    );
  }
}
