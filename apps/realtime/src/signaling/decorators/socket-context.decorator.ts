import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { SignalingSocket, SocketContext } from '../types';

export function extractSocketContext(context: ExecutionContext): SocketContext {
  const client = context.switchToWs().getClient<SignalingSocket>();
  const { roomId, peerId } = client.data;

  if (!roomId || !peerId) {
    throw new WsException('Socket has not joined a room yet');
  }

  return { roomId, peerId };
}

// Turns a missing roomId/peerId into a clear WsException instead of letting
// undefined flow into mediasoup calls expecting a string id.
export const RequireSocketContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SocketContext =>
    extractSocketContext(context),
);
