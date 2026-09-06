import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { SignalingService } from './signaling.service';
import { RequireSocketContext } from './decorators/socket-context.decorator';
import { WsExceptionFilter } from '../common/ws-exception.filter';
import { BroadcastService } from '../broadcast/broadcast.service';
import { PEER_LIVENESS_REFRESH_INTERVAL_MS } from './constants';
import type {
  ConnectTransportPayload,
  ConsumePayload,
  CreateTransportPayload,
  JoinPayload,
  ProducePayload,
  ProducerIdPayload,
  ResumeConsumerPayload,
} from './payloads';
import type { SignalingSocket, SocketContext } from './types';

@WebSocketGateway({ cors: true, transports: ['websocket'] })
@UseFilters(new WsExceptionFilter())
export class SignalingGateway implements OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(SignalingGateway.name);

  constructor(
    private readonly signalingService: SignalingService,
    private readonly broadcastService: BroadcastService,
  ) {}

  // Hands this gateway's Server instance over to BroadcastService, the only
  // seam through which code outside signaling (recovery, issue #34) can
  // still reach clients.
  afterInit(server: Server): void {
    this.broadcastService.setServer(server);
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: SignalingSocket,
    @MessageBody() { roomId, displayName }: JoinPayload,
  ) {
    const peerId = client.id;
    const { peer, existingPeers, existingProducers } =
      await this.signalingService.join(roomId, peerId, displayName);

    client.data.roomId = roomId;
    client.data.peerId = peerId;
    await client.join(roomId);

    // Ties this peer's liveness (issue #31) to its owning instance's process
    // actually being alive, not to any client cooperation - the interval
    // simply stops firing if this instance crashes, letting the Redis key
    // expire on its own. Replaces the removed sessionHeartbeat client event
    // (issue #34), which this liveness refresh depended on before that event
    // was dropped for Session's own now-unrelated reasons.
    client.data.livenessIntervalId = setInterval(() => {
      this.signalingService
        .touchPeerLiveness(roomId, peerId)
        .catch((error) =>
          this.logger.error(
            `Failed to refresh liveness for peer ${peerId} in room ${roomId}`,
            error,
          ),
        );
    }, PEER_LIVENESS_REFRESH_INTERVAL_MS);

    client
      .to(roomId)
      .emit('newPeer', { id: peer.id, displayName: peer.displayName });

    for (const existingProducer of existingProducers) {
      client.emit('newProducer', existingProducer);
    }

    return { peerId, existingPeers };
  }

  @SubscribeMessage('getRouterRtpCapabilities')
  async getRouterRtpCapabilities(
    @RequireSocketContext() { roomId }: SocketContext,
  ) {
    const room = await this.signalingService.getRoom(roomId);
    return room.rtpCapabilities;
  }

  @SubscribeMessage('createWebRtcTransport')
  async createWebRtcTransport(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { direction }: CreateTransportPayload,
  ) {
    return this.signalingService.createWebRtcTransport(
      roomId,
      peerId,
      direction,
    );
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
    const { id } = await this.signalingService.produce(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters,
    );

    client.to(roomId).emit('newProducer', { peerId, producerId: id, kind });

    return { id };
  }

  @SubscribeMessage('consume')
  async consume(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { producerId, rtpCapabilities }: ConsumePayload,
  ) {
    return this.signalingService.consume(
      roomId,
      peerId,
      producerId,
      rtpCapabilities,
    );
  }

  @SubscribeMessage('resumeConsumer')
  async resumeConsumer(
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { consumerId }: ResumeConsumerPayload,
  ) {
    await this.signalingService.resumeConsumer(roomId, peerId, consumerId);

    return { resumed: true };
  }

  @SubscribeMessage('pauseProducer')
  async pauseProducer(
    @ConnectedSocket() client: SignalingSocket,
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { producerId }: ProducerIdPayload,
  ) {
    await this.signalingService.pauseProducer(roomId, peerId, producerId);

    client.to(roomId).emit('producerPaused', { peerId, producerId });

    return { paused: true };
  }

  @SubscribeMessage('resumeProducer')
  async resumeProducer(
    @ConnectedSocket() client: SignalingSocket,
    @RequireSocketContext() { roomId, peerId }: SocketContext,
    @MessageBody() { producerId }: ProducerIdPayload,
  ) {
    await this.signalingService.resumeProducer(roomId, peerId, producerId);

    client.to(roomId).emit('producerResumed', { peerId, producerId });

    return { resumed: true };
  }

  async handleDisconnect(client: SignalingSocket) {
    clearInterval(client.data.livenessIntervalId);

    const { roomId, peerId } = client.data;

    if (!roomId || !peerId) {
      return;
    }

    await this.signalingService.leave(roomId, peerId);
    client.to(roomId).emit('peerClosed', { peerId });
  }
}
