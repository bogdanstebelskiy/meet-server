import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_INSTANCE_REGISTRY_TTL_SECONDS,
} from '../constants';

@Injectable()
export class InstanceRegistryConfigService {
  constructor(private readonly configService: ConfigService) {}

  // No safe fallback like WebRtcConfigService's loopback default - unset
  // disables the heartbeat rather than publish a misleading address.
  get advertisedUrl(): string | undefined {
    return this.configService.get<string>('SFU_ADVERTISED_URL');
  }

  get heartbeatIntervalMs(): number {
    const defaultValue = String(DEFAULT_HEARTBEAT_INTERVAL_MS);
    const value = this.configService.get<string>(
      'SFU_INSTANCE_HEARTBEAT_INTERVAL_MS',
      defaultValue,
    );

    return Number(value);
  }

  get ttlSeconds(): number {
    const defaultValue = String(DEFAULT_INSTANCE_REGISTRY_TTL_SECONDS);
    const value = this.configService.get<string>(
      'SFU_INSTANCE_REGISTRY_TTL_SECONDS',
      defaultValue,
    );

    return Number(value);
  }
}
