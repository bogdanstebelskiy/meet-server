import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TransportPortRange } from 'mediasoup/types';

@Injectable()
export class WebRtcConfigService {
  private readonly logger = new Logger(WebRtcConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  // Must be this machine's real LAN IP, not 127.0.0.1 or 0.0.0.0, for real
  // cross-device/browser ICE negotiation - Firefox won't pair a real local
  // ICE candidate against a loopback remote one, and 0.0.0.0 isn't
  // connectable at all. Falls back to 127.0.0.1 for local dev/tests, where
  // no real ICE/DTLS negotiation happens.
  get announcedAddress(): string {
    const value = this.configService.get<string>('WEBRTC_ANNOUNCED_ADDRESS');

    if (!value) {
      this.logger.warn(
        'WEBRTC_ANNOUNCED_ADDRESS not set, falling back to 127.0.0.1 - ' +
          'real cross-device WebRTC connections will fail',
      );

      return '127.0.0.1';
    }

    return value;
  }

  get portRange(): TransportPortRange {
    return {
      min: Number(this.configService.get('WEBRTC_PORT_RANGE_MIN', '40000')),
      max: Number(this.configService.get('WEBRTC_PORT_RANGE_MAX', '49999')),
    };
  }
}
