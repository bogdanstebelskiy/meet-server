import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup/types';
import { RoomsService } from '../rooms/rooms.service';
import { Peer } from '../rooms/entities/peer.entity';
import { webRtcAnnouncedAddress, webRtcPortRange } from '../sfu/config';
import { TRANSPORT_DIRECTIONS } from './types';
import type { TransportDirection } from './types';

@Injectable()
export class SignalingService {
  constructor(private readonly roomsService: RoomsService) {}

  async join(roomId: string, peerId: string, displayName: string) {
    const room = await this.roomsService.getOrCreateRoom(roomId);
    const otherPeers = room.getOtherPeers(peerId);
    const existingPeers = otherPeers.map((peer) => ({
      id: peer.id,
      displayName: peer.displayName,
    }));

    const existingProducers = otherPeers.flatMap((peer) =>
      [...peer.producers.values()].map((producer) => ({
        peerId: peer.id,
        producerId: producer.id,
        kind: producer.kind,
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
    const room = this.getRoom(roomId);
    const peer = room.peers.get(peerId);

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
    const room = this.getRoom(roomId);
    const peer = this.getPeer(roomId, peerId);

    const transport = await room.router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: 'udp',
          ip: '0.0.0.0',
          announcedAddress: webRtcAnnouncedAddress,
          portRange: webRtcPortRange,
        },
        {
          protocol: 'tcp',
          ip: '0.0.0.0',
          announcedAddress: webRtcAnnouncedAddress,
          portRange: webRtcPortRange,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    if (direction === TRANSPORT_DIRECTIONS.SEND) {
      peer.sendTransport = transport;
    } else {
      peer.recvTransport = transport;
    }

    return transport;
  }

  async connectWebRtcTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ) {
    const transport = this.findTransport(roomId, peerId, transportId);

    await transport.connect({ dtlsParameters });
  }

  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ) {
    const peer = this.getPeer(roomId, peerId);

    if (peer.sendTransport?.id !== transportId) {
      throw new NotFoundException(
        `Send transport ${transportId} not found for peer ${peerId}`,
      );
    }

    const producer = await peer.sendTransport.produce({ kind, rtpParameters });
    peer.producers.set(producer.id, producer);

    return producer;
  }

  async consume(
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ) {
    const room = this.getRoom(roomId);
    const peer = this.getPeer(roomId, peerId);

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new NotFoundException(`Cannot consume producer ${producerId}`);
    }

    if (!peer.recvTransport) {
      throw new NotFoundException(`Peer ${peerId} has no recv transport`);
    }

    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);

    return consumer;
  }

  async resumeConsumer(roomId: string, peerId: string, consumerId: string) {
    const peer = this.getPeer(roomId, peerId);
    const consumer = peer.consumers.get(consumerId);

    if (!consumer) {
      throw new NotFoundException(
        `Consumer ${consumerId} not found for peer ${peerId}`,
      );
    }

    await consumer.resume();
  }

  async pauseProducer(roomId: string, peerId: string, producerId: string) {
    const producer = this.findProducer(roomId, peerId, producerId);

    await producer.pause();
  }

  async resumeProducer(roomId: string, peerId: string, producerId: string) {
    const producer = this.findProducer(roomId, peerId, producerId);

    await producer.resume();
  }

  leave(roomId: string, peerId: string): void {
    const room = this.roomsService.getRoom(roomId);

    if (!room) {
      return;
    }

    room.removePeer(peerId);

    if (room.isEmpty()) {
      this.roomsService.closeRoom(roomId);
    }
  }

  private findProducer(roomId: string, peerId: string, producerId: string) {
    const peer = this.getPeer(roomId, peerId);
    const producer = peer.producers.get(producerId);

    if (!producer) {
      throw new NotFoundException(
        `Producer ${producerId} not found for peer ${peerId}`,
      );
    }

    return producer;
  }

  private findTransport(roomId: string, peerId: string, transportId: string) {
    const peer = this.getPeer(roomId, peerId);

    if (peer.sendTransport?.id === transportId) {
      return peer.sendTransport;
    }

    if (peer.recvTransport?.id === transportId) {
      return peer.recvTransport;
    }

    throw new NotFoundException(
      `Transport ${transportId} not found for peer ${peerId}`,
    );
  }
}
