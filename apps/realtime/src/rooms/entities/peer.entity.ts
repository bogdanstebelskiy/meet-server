import type { MediaKind } from 'mediasoup/types';

export class Peer {
  readonly id: string;
  displayName: string;

  // producerId -> kind, just enough to backfill newProducer for late
  // joiners; the mediasoup Producer objects themselves live in apps/sfu.
  readonly producers = new Map<string, MediaKind>();

  constructor(id: string, displayName: string) {
    this.id = id;
    this.displayName = displayName;
  }
}
