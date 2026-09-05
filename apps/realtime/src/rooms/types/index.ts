import type { MediaKind, RtpCapabilities } from 'mediasoup/types';

export interface Room {
  readonly id: string;
  readonly rtpCapabilities: RtpCapabilities;
}

export interface Peer {
  readonly id: string;
  readonly displayName: string;
}

export interface RoomProducer {
  producerId: string;
  kind: MediaKind;
}
