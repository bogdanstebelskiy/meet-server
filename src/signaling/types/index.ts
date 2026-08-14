import type { DefaultEventsMap, Socket } from 'socket.io';

export const TRANSPORT_DIRECTIONS = {
  SEND: 'send',
  RECV: 'recv',
} as const;

export type TransportDirection =
  (typeof TRANSPORT_DIRECTIONS)[keyof typeof TRANSPORT_DIRECTIONS];

export interface SocketContext {
  roomId: string;
  peerId: string;
}

export type SignalingSocketData = Partial<SocketContext>;

export type SignalingSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SignalingSocketData
>;
