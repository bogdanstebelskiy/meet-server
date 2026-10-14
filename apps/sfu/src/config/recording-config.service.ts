import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecordingConfigService {
  constructor(private readonly configService: ConfigService) {}

  get outputDir(): string {
    return this.configService.get<string>('RECORDING_OUTPUT_DIR', './recordings');
  }

  get listenIp(): string {
    return this.configService.get<string>('RECORDING_LISTEN_IP', '127.0.0.1');
  }
}
