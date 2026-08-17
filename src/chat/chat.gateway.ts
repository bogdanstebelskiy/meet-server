import { NotFoundException, UseFilters } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { ChatService } from './chat.service';
import { RoomsService } from '../rooms/rooms.service';
import { RequireSocketContext } from '../signaling/decorators/socket-context.decorator';
import { WsExceptionFilter } from '../common/ws-exception.filter';
import type { SendChatMessagePayload } from './payloads';
import type { SocketContext } from '../signaling/types';

@WebSocketGateway({ cors: true })
@UseFilters(new WsExceptionFilter())
export class ChatGateway {
  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly roomsService: RoomsService,
  ) {}

  @SubscribeMessage('sendChatMessage')
  async sendChatMessage(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { body }: SendChatMessagePayload,
  ) {
    const peer = this.roomsService.getPeer(roomId, peerId);

    if (!peer) {
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    const message = await this.chatService.addMessage(roomId, {
      peerId,
      displayName: peer.displayName,
      body,
      ts: Date.now(),
    });

    this.server.to(roomId).emit('chatMessage', message);

    return { ok: true };
  }

  @SubscribeMessage('getChatHistory')
  async getChatHistory(@RequireSocketContext() { roomId }: SocketContext) {
    const messages = await this.chatService.getHistory(roomId);

    return { messages };
  }
}
