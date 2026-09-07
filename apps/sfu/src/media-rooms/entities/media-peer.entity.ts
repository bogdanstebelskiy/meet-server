import type { Consumer, Producer, WebRtcTransport } from 'mediasoup/types';

export class MediaPeer {
  readonly id: string;

  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;

  readonly producers = new Map<string, Producer>();
  readonly consumers = new Map<string, Consumer>();

  constructor(id: string) {
    this.id = id;
  }
}