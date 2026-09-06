import type { Router, Worker } from 'mediasoup/types';
import { MediaPeer } from './media-peer.entity';

export class MediaRoom {
  readonly id: string;
  readonly router: Router;
  readonly worker: Worker;

  readonly peers = new Map<string, MediaPeer>();

  // Refreshed by every REST call that touches this room - the stale-sweep
  // module force-closes a room whose activity falls too far behind now().
  lastActivityAt: number;

  constructor(
    id: string,
    router: Router,
    worker: Worker,
    now: number = Date.now(),
  ) {
    this.id = id;
    this.router = router;
    this.worker = worker;
    this.lastActivityAt = now;
  }

  touch(now: number = Date.now()): void {
    this.lastActivityAt = now;
  }

  isStaleAsOf(now: number, thresholdMs: number): boolean {
    return now - this.lastActivityAt > thresholdMs;
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

  // Closing a transport cascades to every producer/consumer on it.
  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);

    if (!peer) {
      return;
    }

    peer.sendTransport?.close();
    peer.recvTransport?.close();
    this.peers.delete(peerId);
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  // Closing the router cascades to every transport/producer/consumer in it.
  close(): void {
    this.router.close();
  }
}
