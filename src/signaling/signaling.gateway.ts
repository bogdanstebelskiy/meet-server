import { UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { SignalingService } from './signaling.service';
import { RequireSocketContext } from './decorators/socket-context.decorator';
import { WsExceptionFilter } from '../common/ws-exception.filter';
import type {
  ConnectTransportPayload,
  ConsumePayload,
  CreateTransportPayload,
  JoinPayload,
  ProducePayload,
  ResumeConsumerPayload,
} from './payloads';
import type { SignalingSocket, SocketContext } from './types';

@WebSocketGateway({ cors: true })
@UseFilters(new WsExceptionFilter())
export class SignalingGateway implements OnGatewayDisconnect {
  constructor(private readonly signalingService: SignalingService) {}

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: SignalingSocket,
    @MessageBody() { roomId, displayName }: JoinPayload,
  ) {
    const peerId = client.id;
    const { peer, existingPeers } = await this.signalingService.join(
      roomId,
      peerId,
      displayName,
    );

    client.data.roomId = roomId;
    client.data.peerId = peerId;
    await client.join(roomId);

    client
      .to(roomId)
      .emit('newPeer', { id: peer.id, displayName: peer.displayName });

    return { peerId, existingPeers };
  }

  @SubscribeMessage('getRouterRtpCapabilities')
  getRouterRtpCapabilities(@RequireSocketContext() { roomId }: SocketContext) {
    return this.signalingService.getRoom(roomId).router.rtpCapabilities;
  }

  @SubscribeMessage('createWebRtcTransport')
  async createWebRtcTransport(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { direction }: CreateTransportPayload,
  ) {
    const transport = await this.signalingService.createWebRtcTransport(
      roomId,
      peerId,
      direction,
    );

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  @SubscribeMessage('connectWebRtcTransport')
  async connectWebRtcTransport(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { transportId, dtlsParameters }: ConnectTransportPayload,
  ) {
    await this.signalingService.connectWebRtcTransport(
      roomId,
      peerId,
      transportId,
      dtlsParameters,
    );

    return { connected: true };
  }

  @SubscribeMessage('produce')
  async produce(
    @ConnectedSocket() client: SignalingSocket,
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { transportId, kind, rtpParameters }: ProducePayload,
  ) {
    const producer = await this.signalingService.produce(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters,
    );

    client.to(roomId).emit('newProducer', {
      peerId,
      producerId: producer.id,
      kind: producer.kind,
    });

    return { id: producer.id };
  }

  @SubscribeMessage('consume')
  async consume(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { producerId, rtpCapabilities }: ConsumePayload,
  ) {
    const consumer = await this.signalingService.consume(
      roomId,
      peerId,
      producerId,
      rtpCapabilities,
    );

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  @SubscribeMessage('resumeConsumer')
  async resumeConsumer(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { consumerId }: ResumeConsumerPayload,
  ) {
    await this.signalingService.resumeConsumer(roomId, peerId, consumerId);

    return { resumed: true };
  }

  handleDisconnect(client: SignalingSocket) {
    const { roomId, peerId } = client.data;

    if (!roomId || !peerId) {
      return;
    }

    this.signalingService.leave(roomId, peerId);
    client.to(roomId).emit('peerClosed', { peerId });
  }
}
