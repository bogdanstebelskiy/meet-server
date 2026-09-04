import type { MediaKind } from 'mediasoup/types';

export interface RoomProducer {
  producerId: string;
  kind: MediaKind;
}
