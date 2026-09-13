import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'node:os';
import type { WorkerSettings } from 'mediasoup/types';

@Injectable()
export class WorkerSettingsConfigService {
  constructor(private readonly configService: ConfigService) {}

  get settings(): WorkerSettings {
    return {
      logLevel: 'debug',
      logTags: ['info', 'ice', 'dtls', 'rtcp'],
    };
  }

  // os.cpus().length reports the host's full core count, not a container/pod
  // CPU limit (Docker --cpus / k8s limits throttle CPU time via a CFS quota,
  // they don't change what /proc/cpuinfo reports) - so running multiple sfu
  // replicas on one machine needs this explicitly capped per replica instead.
  get numWorkers(): number {
    const configured = this.configService.get<string>('SFU_WORKER_POOL_SIZE');

    if (configured) {
      return Number(configured);
    }

    return os.cpus().length;
  }
}
