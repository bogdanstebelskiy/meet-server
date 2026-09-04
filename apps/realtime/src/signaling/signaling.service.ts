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
    await this.roomsService.getOrCreateRoom(roomId);

    // Add this peer before reading others, not after - otherwise two peers
    // joining a brand-new room at the same instant can each read the peers
    // hash before the other's write lands, and neither sees the other.
    const peer: Peer = { id: peerId, displayName };
    await this.roomsService.addPeer(roomId, peer);

    try {
      const otherPeers = await this.roomsService.getOtherPeers(roomId, peerId);
      const existingPeers = otherPeers.map((otherPeer) => ({
        id: otherPeer.id,
        displayName: otherPeer.displayName,
      }));

      const producerFetchPromises = otherPeers.map(async (otherPeer) => {
        const producers = await this.roomsService.getProducers(
          roomId,
          otherPeer.id,
        );
        const producersWithPeerId = producers.map(({ producerId, kind }) => ({
          peerId: otherPeer.id,
          producerId,
          kind,
        }));
        return producersWithPeerId;
      });

      const producersByPeer = await Promise.all(producerFetchPromises);
      const existingProducers = producersByPeer.flat();

      return { peer, existingPeers, existingProducers };
    } catch (error) {
      // Roll back the add above - otherwise a failure here leaves a ghost
      // peer nothing ever cleans up (the gateway never learns this peer's
      // roomId/peerId when join() rejects, so its own disconnect handler
      // can't remove it either).
      await this.roomsService.removePeer(roomId, peerId);
      throw error;
    }
  }

  async getRoom(roomId: string) {
    const room = await this.roomsService.getRoom(roomId);

    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    return room;
  }

  async getPeer(roomId: string, peerId: string): Promise<Peer> {
    const peer = await this.roomsService.getPeer(roomId, peerId);

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
    await this.getPeer(roomId, peerId);

    return this.sfuClient.createTransport(roomId, peerId, direction);
  }

  async connectWebRtcTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ) {
    await this.getPeer(roomId, peerId);

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
    await this.getPeer(roomId, peerId);

    const { id } = await this.sfuClient.produce(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters,
    );
    await this.roomsService.addProducer(roomId, peerId, id, kind);

    return { id };
  }

  async consume(
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ) {
    await this.getPeer(roomId, peerId);

    return this.sfuClient.consume(roomId, peerId, producerId, rtpCapabilities);
  }

  async resumeConsumer(roomId: string, peerId: string, consumerId: string) {
    await this.getPeer(roomId, peerId);

    await this.sfuClient.resumeConsumer(roomId, peerId, consumerId);
  }

  async pauseProducer(roomId: string, peerId: string, producerId: string) {
    await this.getPeer(roomId, peerId);

    await this.sfuClient.pauseProducer(roomId, peerId, producerId);
  }

  async resumeProducer(roomId: string, peerId: string, producerId: string) {
    await this.getPeer(roomId, peerId);

    await this.sfuClient.resumeProducer(roomId, peerId, producerId);
  }

  async leave(roomId: string, peerId: string): Promise<void> {
    const room = await this.roomsService.getRoom(roomId);

    if (!room) {
      return;
    }

    await this.roomsService.removePeer(roomId, peerId);

    try {
      // Must be awaited, not fire-and-forget - closeRoom below checks
      // room.isEmpty() in apps/sfu too, and a still-in-flight removal would
      // make it see this peer as still present and no-op forever, since
      // nothing ever retries closeRoom once the Redis room key is gone.
      await this.sfuClient.removePeer(roomId, peerId);
    } catch (error) {
      this.logger.error(
        `Failed to remove peer ${peerId} from sfu room ${roomId}`,
        error,
      );
    }

    const isRoomEmpty = await this.roomsService.isEmpty(roomId);
    if (isRoomEmpty) {
      await this.roomsService.closeRoom(roomId);
      this.sfuClient
        .closeRoom(roomId)
        .catch((error) =>
          this.logger.error(`Failed to close sfu room ${roomId}`, error),
        );
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
