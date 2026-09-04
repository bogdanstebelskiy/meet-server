import type { DefaultEventsMap, Socket } from 'socket.io';
import type { TransportDirection } from '@app/media-contracts';

export type { TransportDirection };

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
