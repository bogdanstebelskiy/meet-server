import { Injectable } from '@nestjs/common';
import type { WorkerSettings } from 'mediasoup/types';

@Injectable()
export class WorkerSettingsConfigService {
  get settings(): WorkerSettings {
    return {
      logLevel: 'debug',
      logTags: ['info', 'ice', 'dtls', 'rtcp'],
    };
  }
}
