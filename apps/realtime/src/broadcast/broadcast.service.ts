import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

// The one seam through which code outside signaling (recovery, issue #34)
// can still reach clients - SignalingGateway hands over its Server instance
// via setServer once at startup, everyone else only ever calls
// broadcastToRoom. Backed by @socket.io/redis-adapter, so this reaches
// sockets on every realtime instance, not just this one.
@Injectable()
export class BroadcastService {
  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  broadcastToRoom(roomId: string, event: string, payload: unknown): void {
    if (!this.server) {
      return;
    }

    this.server.to(roomId).emit(event, payload);
  }
}
