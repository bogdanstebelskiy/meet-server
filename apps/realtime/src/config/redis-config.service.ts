import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisConfigService {
  constructor(private readonly configService: ConfigService) {}

  get url(): string {
    return this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
  }

  get auth(): string | undefined {
    return this.configService.get<string>('REDIS_AUTH');
  }
}
