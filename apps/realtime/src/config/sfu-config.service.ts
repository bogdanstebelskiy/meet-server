import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SfuConfigService {
  constructor(private readonly configService: ConfigService) {}

  get serviceUrl(): string {
    return this.configService.get<string>(
      'SFU_SERVICE_URL',
      'http://localhost:3001',
    );
  }
}
