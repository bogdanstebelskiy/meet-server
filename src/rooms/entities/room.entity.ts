import type { Router, Worker } from 'mediasoup/types';
import { Peer } from './peer.entity';

export class Room {
  readonly id: string;
  readonly router: Router;
  readonly worker: Worker;

  readonly peers = new Map<string, Peer>();

  constructor(id: string, router: Router, worker: Worker) {
    this.id = id;
    this.router = router;
    this.worker = worker;
  }

  addPeer(peer: Peer): void {
    this.peers.set(peer.id, peer);
  }

  removePeer(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
  }

  getOtherPeers(excludePeerId: string): Peer[] {
    return [...this.peers.values()].filter((peer) => peer.id !== excludePeerId);
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  // Closing the router cascades to every transport/producer/consumer in it.
  close(): void {
    this.router.close();
  }
}
