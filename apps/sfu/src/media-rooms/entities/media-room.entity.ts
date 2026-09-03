import type { Router, Worker } from 'mediasoup/types';
import { MediaPeer } from './media-peer.entity';

export class MediaRoom {
  readonly id: string;
  readonly router: Router;
  readonly worker: Worker;

  readonly peers = new Map<string, MediaPeer>();

  constructor(id: string, router: Router, worker: Worker) {
    this.id = id;
    this.router = router;
    this.worker = worker;
  }

  getOrCreatePeer(peerId: string): MediaPeer {
    let peer = this.peers.get(peerId);

    if (!peer) {
      peer = new MediaPeer(peerId);
      this.peers.set(peerId, peer);
    }

    return peer;
  }

  getPeer(peerId: string): MediaPeer | undefined {
    return this.peers.get(peerId);
  }

  // Closing the router cascades to every transport/producer/consumer in it.
  close(): void {
    this.router.close();
  }
}
