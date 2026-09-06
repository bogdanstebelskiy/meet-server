import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_STALE_ROOM_THRESHOLD_MS,
  DEFAULT_STALE_SWEEP_INTERVAL_MS,
} from '../constants';

@Injectable()
export class StaleSweepConfigService {
  constructor(private readonly configService: ConfigService) {}

  get thresholdMs(): number {
    const defaultValue = String(DEFAULT_STALE_ROOM_THRESHOLD_MS);
    const value = this.configService.get<string>(
      'SFU_STALE_ROOM_THRESHOLD_MS',
      defaultValue,
    );

    return Number(value);
  }

  get sweepIntervalMs(): number {
    const defaultValue = String(DEFAULT_STALE_SWEEP_INTERVAL_MS);
    const value = this.configService.get<string>(
      'SFU_STALE_SWEEP_INTERVAL_MS',
      defaultValue,
    );

    return Number(value);
  }
}
