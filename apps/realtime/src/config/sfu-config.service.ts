import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SfuConfigService {
  constructor(private readonly configService: ConfigService) {}

  // One realtime deployment can front several independent sfu instances -
  // rooms are pinned to whichever one is least loaded at creation time (see
  // SfuRegistryService), not routed through a load balancer.
  get serviceUrls(): string[] {
    const raw = this.configService.get<string>('SFU_SERVICE_URLS', 'http://localhost:3001');

    const rawUrls = raw.split(',');
    const trimmedUrls = rawUrls.map((url) => url.trim());
    const urls = trimmedUrls.filter((url) => url.length > 0);

    return urls;
  }
}
