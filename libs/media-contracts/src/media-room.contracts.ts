import type {
  DtlsParameters,
  IceCandidate,
  IceParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup/types';

export const TRANSPORT_DIRECTIONS = {
  SEND: 'send',
  RECV: 'recv',
} as const;

export type TransportDirection =
  (typeof TRANSPORT_DIRECTIONS)[keyof typeof TRANSPORT_DIRECTIONS];

export interface MediaRoomResponse {
  roomId: string;
  rtpCapabilities: RtpCapabilities;
}

export interface CreateTransportRequest {
  direction: TransportDirection;
}

export interface CreateTransportResponse {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export interface ConnectTransportRequest {
  dtlsParameters: DtlsParameters;
}

export interface ConnectTransportResponse {
  connected: true;
}

export interface ProduceRequest {
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

export interface ProduceResponse {
  id: string;
}

export interface ConsumeRequest {
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

export interface ConsumeResponse {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  producerPaused: boolean;
}

export interface ResumeConsumerResponse {
  resumed: true;
}

export interface PauseProducerResponse {
  paused: true;
}

export interface ResumeProducerResponse {
  resumed: true;
}

export interface RemovePeerResponse {
  removed: true;
}

export interface CloseRoomResponse {
  closed: boolean;
}

// Lets callers match on a stable code instead of message text (issue #34).
export const MEDIA_ROOM_ERROR_CODE = {
  MEDIA_ROOM_NOT_FOUND: 'MEDIA_ROOM_NOT_FOUND',
} as const;

export type MediaRoomErrorCode =
  (typeof MEDIA_ROOM_ERROR_CODE)[keyof typeof MEDIA_ROOM_ERROR_CODE];

export interface MediaRoomErrorBody {
  statusCode: number;
  message: string;
  errorCode?: MediaRoomErrorCode;
}
