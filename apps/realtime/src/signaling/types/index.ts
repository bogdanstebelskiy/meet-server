import type { DefaultEventsMap, Socket } from 'socket.io';
import type { TransportDirection } from '@app/media-contracts';

export type { TransportDirection };

export interface SocketContext {
  roomId: string;
  peerId: string;
}

export interface SignalingSocketData extends Partial<SocketContext> {
  livenessIntervalId?: NodeJS.Timeout;
}

export type SignalingSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SignalingSocketData
>;
