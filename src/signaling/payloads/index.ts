import type {
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup/types';
import type { TransportDirection } from '../types';

export interface JoinPayload {
  roomId: string;
  displayName: string;
}

export interface CreateTransportPayload {
  direction: TransportDirection;
}

export interface ConnectTransportPayload {
  transportId: string;
  dtlsParameters: DtlsParameters;
}

export interface ProducePayload {
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

export interface ConsumePayload {
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

export interface ResumeConsumerPayload {
  consumerId: string;
}
