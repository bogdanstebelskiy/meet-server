import type { Router, Worker } from 'mediasoup/types';
import { MediaPeer } from './media-peer.entity';

export class MediaRoom {
  readonly id: string;
  readonly router: Router;
  readonly worker: Worker;
  readonly createdAt = new Date();

  recording = false;
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

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);

    if (!peer) {
      return;
    }

    this.stopPeerRecording(peer);
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    this.peers.delete(peerId);
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  close(): void {
    this.router.close();
  }

  private stopPeerRecording(peer: MediaPeer): void {
    const session = peer.recordingSession;

    if (session && !session.closed) {
      session.closed = true;
      session.socket.close();
      session.fileHandle.close().catch(() => {});
    }

    peer.recordingSession = undefined;

    if (peer.recordingConsumer && !peer.recordingConsumer.closed) {
      peer.recordingConsumer.close();
      peer.recordingConsumer = undefined;
    }

    if (peer.plainTransport && !peer.plainTransport.closed) {
      peer.plainTransport.close();
      peer.plainTransport = undefined;
    }
  }
}
