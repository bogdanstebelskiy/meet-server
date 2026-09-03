import type { Consumer, Producer, WebRtcTransport } from 'mediasoup/types';

export class Peer {
  readonly id: string;
  displayName: string;

  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;

  readonly producers = new Map<string, Producer>();
  readonly consumers = new Map<string, Consumer>();

  constructor(id: string, displayName: string) {
    this.id = id;
    this.displayName = displayName;
  }

  // Closing a transport cascades to every producer/consumer on it.
  close(): void {
    this.sendTransport?.close();
    this.recvTransport?.close();
  }
}
