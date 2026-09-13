import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Worker,
} from 'mediasoup/types';
import { TRANSPORT_DIRECTIONS } from '@app/media-contracts';
import type { TransportDirection } from '@app/media-contracts';
import { WorkerPoolService } from '../workers/worker-pool.service';
import { WebRtcConfigService } from '../config/webrtc-config.service';
import { MediaCodecsConfigService } from '../config/media-codecs-config.service';
import { MediaRoom } from './entities/media-room.entity';
import { MediaPeer } from './entities/media-peer.entity';

@Injectable()
export class MediaRoomsService {
  private readonly rooms = new Map<string, MediaRoom>();
  private readonly pendingRooms = new Map<string, Promise<MediaRoom>>();

  constructor(
    private readonly workerPool: WorkerPoolService,
    private readonly webRtcConfig: WebRtcConfigService,
    private readonly mediaCodecsConfig: MediaCodecsConfigService,
  ) {}

  async getOrCreateRoom(roomId: string): Promise<MediaRoom> {
    const existing = this.rooms.get(roomId);

    if (existing) {
      return existing;
    }

    const pending = this.pendingRooms.get(roomId);

    if (pending) {
      return pending;
    }

    const creation = this.createRoom(roomId);
    this.pendingRooms.set(roomId, creation);

    try {
      return await creation;
    } finally {
      this.pendingRooms.delete(roomId);
    }
  }

  private async createRoom(roomId: string): Promise<MediaRoom> {
    const worker = this.workerPool.reserveWorker();
    const router = await this.createRouterOrReleaseWorker(worker);

    const room = new MediaRoom(roomId, router, worker);
    this.rooms.set(roomId, room);

    return room;
  }

  private async createRouterOrReleaseWorker(worker: Worker) {
    try {
      const mediaCodecs = this.mediaCodecsConfig.codecs;
      return await worker.createRouter({ mediaCodecs });
    } catch (error) {
      this.workerPool.trackRouterClosed(worker);
      throw error;
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): MediaRoom {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new NotFoundException(`MediaRoom ${roomId} not found`);
    }

    return room;
  }

  getPeer(roomId: string, peerId: string): MediaPeer {
    const room = this.getRoom(roomId);
    const peer = room.getPeer(peerId);

    if (!peer) {
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    return peer;
  }

  async createTransport(roomId: string, peerId: string, direction: TransportDirection) {
    const room = this.getRoom(roomId);
    const peerExisted = room.hasPeer(peerId);
    const peer = room.getOrCreatePeer(peerId);

    let transport: WebRtcTransport;

    try {
      const transportOptions = this.webRtcConfig.webRtcTransportOptions;
      transport = await room.router.createWebRtcTransport(transportOptions);
    } catch (error) {
      this.discardPeerIfJustCreated(room, peerId, peerExisted);
      throw error;
    }

    const peerRemovedDuringCreation = room.getPeer(peerId) !== peer;

    if (peerRemovedDuringCreation) {
      transport.close();
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    if (direction === TRANSPORT_DIRECTIONS.SEND) {
      peer.sendTransport?.close();
      peer.sendTransport = transport;
    } else {
      peer.recvTransport?.close();
      peer.recvTransport = transport;
    }

    return transport;
  }

  private discardPeerIfJustCreated(room: MediaRoom, peerId: string, peerExisted: boolean): void {
    if (peerExisted) {
      return;
    }

    room.removePeer(peerId);
  }

  async connectTransport(
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
      throw new NotFoundException(`Send transport ${transportId} not found for peer ${peerId}`);
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
    const canConsume = room.router.canConsume({ producerId, rtpCapabilities });

    if (!canConsume) {
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

    if (!consumer || consumer.closed) {
      throw new NotFoundException(`Consumer ${consumerId} not found for peer ${peerId}`);
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

  removePeer(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);

    if (!room) {
      return;
    }

    room.removePeer(peerId);
  }

  closeRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) {
      return true;
    }

    if (!room.isEmpty()) {
      return false;
    }

    room.close();
    this.workerPool.trackRouterClosed(room.worker);
    this.rooms.delete(roomId);

    return true;
  }

  private findProducer(roomId: string, peerId: string, producerId: string) {
    const peer = this.getPeer(roomId, peerId);
    const producer = peer.producers.get(producerId);

    if (!producer || producer.closed) {
      throw new NotFoundException(`Producer ${producerId} not found for peer ${peerId}`);
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

    throw new NotFoundException(`Transport ${transportId} not found for peer ${peerId}`);
  }
}
