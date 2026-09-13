import type { MediaKind, RtpCapabilities } from 'mediasoup/types';

export interface Room {
  readonly id: string;
  readonly rtpCapabilities: RtpCapabilities;
  // The sfu instance holding this room's MediaRoom/Router, picked once at
  // creation and stuck to for the room's lifetime (mediasoup Routers don't
  // migrate - see docs/sfu-signaling-design.md).
  readonly sfuNodeUrl: string;
}

export interface Peer {
  readonly id: string;
  readonly displayName: string;
}

export interface RoomProducer {
  producerId: string;
  kind: MediaKind;
}
