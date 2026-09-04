import type { RtpCapabilities } from 'mediasoup/types';
import { Peer } from './peer.entity';

export class Room {
  readonly id: string;
  readonly rtpCapabilities: RtpCapabilities;

  readonly peers = new Map<string, Peer>();

  constructor(id: string, rtpCapabilities: RtpCapabilities) {
    this.id = id;
    this.rtpCapabilities = rtpCapabilities;
  }

  addPeer(peer: Peer): void {
    this.peers.set(peer.id, peer);
  }

  // apps/sfu has no per-peer teardown endpoint yet (tracked in #18), so this
  // only forgets the Peer locally - a peer leaving a still-populated room
  // leaks its transports/producers/consumers in apps/sfu until #18 lands,
  // not just the whole-room case RoomsService.closeRoom already documents.
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getOtherPeers(excludePeerId: string): Peer[] {
    return [...this.peers.values()].filter((peer) => peer.id !== excludePeerId);
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }
}
