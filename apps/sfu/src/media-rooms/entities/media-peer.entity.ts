import type { Consumer, PlainTransport, Producer, WebRtcTransport } from 'mediasoup/types';
import type { RecordingSession } from '../../recording/types';

export class MediaPeer {
  readonly id: string;
  displayName?: string;

  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;

  readonly producers = new Map<string, Producer>();
  readonly consumers = new Map<string, Consumer>();

  plainTransport?: PlainTransport;
  recordingConsumer?: Consumer;
  recordingSession?: RecordingSession;

  constructor(id: string) {
    this.id = id;
  }
}
