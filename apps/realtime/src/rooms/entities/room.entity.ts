import type { RtpCapabilities } from 'mediasoup/types';

export interface Room {
  readonly id: string;
  readonly rtpCapabilities: RtpCapabilities;
}
