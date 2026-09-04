import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup/types';
import { RoomsService } from '../rooms/rooms.service';
import { SfuClientService } from '../sfu-client/sfu-client.service';
import { Peer } from '../rooms/entities/peer.entity';
import { ChatService } from '../chat/chat.service';
import type { TransportDirection } from './types';

@Injectable()
export class SignalingService {
  private readonly logger = new Logger(SignalingService.name);

  constructor(
    private readonly roomsService: RoomsService,
    private readonly sfuClient: SfuClientService,
    private readonly chatService: ChatService,
  ) {}

  async join(roomId: string, peerId: string, displayName: string) {
    const room = await this.roomsService.getOrCreateRoom(roomId);
    const otherPeers = room.getOtherPeers(peerId);
    const existingPeers = otherPeers.map((peer) => ({
      id: peer.id,
      displayName: peer.displayName,
    }));

    const existingProducers = otherPeers.flatMap((peer) =>
      [...peer.producers.entries()].map(([producerId, kind]) => ({
        peerId: peer.id,
        producerId,
        kind,
      })),
    );

    const peer = new Peer(peerId, displayName);
    room.addPeer(peer);

    return { peer, existingPeers, existingProducers };
  }

  getRoom(roomId: string) {
    const room = this.roomsService.getRoom(roomId);

    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    return room;
  }

  getPeer(roomId: string, peerId: string): Peer {
    const peer = this.roomsService.getPeer(roomId, peerId);

    if (!peer) {
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    return peer;
  }

  async createWebRtcTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ) {
    this.getPeer(roomId, peerId);

    return this.sfuClient.createTransport(roomId, peerId, direction);
  }

  async connectWebRtcTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ) {
    this.getPeer(roomId, peerId);

    await this.sfuClient.connectTransport(
      roomId,
      peerId,
      transportId,
      dtlsParameters,
    );
  }

  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ) {
    const peer = this.getPeer(roomId, peerId);

    const { id } = await this.sfuClient.produce(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters,
    );
    peer.producers.set(id, kind);

    return { id };
  }

  async consume(
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ) {
    this.getPeer(roomId, peerId);

    return this.sfuClient.consume(roomId, peerId, producerId, rtpCapabilities);
  }

  async resumeConsumer(roomId: string, peerId: string, consumerId: string) {
    this.getPeer(roomId, peerId);

    await this.sfuClient.resumeConsumer(roomId, peerId, consumerId);
  }

  async pauseProducer(roomId: string, peerId: string, producerId: string) {
    this.getPeer(roomId, peerId);

    await this.sfuClient.pauseProducer(roomId, peerId, producerId);
  }

  async resumeProducer(roomId: string, peerId: string, producerId: string) {
    this.getPeer(roomId, peerId);

    await this.sfuClient.resumeProducer(roomId, peerId, producerId);
  }

  leave(roomId: string, peerId: string): void {
    const room = this.roomsService.getRoom(roomId);

    if (!room) {
      return;
    }

    room.removePeer(peerId);

    if (room.isEmpty()) {
      this.roomsService.closeRoom(roomId);
      this.chatService
        .deleteRoomHistory(roomId)
        .catch((error) =>
          this.logger.error(
            `Failed to delete chat history for room ${roomId}`,
            error,
          ),
        );
    }
  }
}
