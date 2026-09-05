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
import { mediaCodecs } from '../config';
import { MediaRoom } from './entities/media-room.entity';
import { MediaPeer } from './entities/media-peer.entity';

@Injectable()
export class MediaRoomsService {
  private readonly rooms = new Map<string, MediaRoom>();
  // Dedupes concurrent getOrCreateRoom calls for a new roomId, so two
  // concurrent requests for a brand-new room don't each create their own
  // router.
  private readonly pendingRooms = new Map<string, Promise<MediaRoom>>();

  constructor(
    private readonly workerPool: WorkerPoolService,
    private readonly webRtcConfig: WebRtcConfigService,
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
      return await worker.createRouter({ mediaCodecs });
    } catch (error) {
      // createRouter never resolved - give back the slot reserveWorker took.
      this.workerPool.trackRouterClosed(worker);
      throw error;
    }
  }

  getRoom(roomId: string): MediaRoom {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new NotFoundException(`MediaRoom ${roomId} not found`);
    }

    return room;
  }

  getPeer(roomId: string, peerId: string): MediaPeer {
    const peer = this.getRoom(roomId).getPeer(peerId);

    if (!peer) {
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    return peer;
  }

  async createTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ) {
    const room = this.getRoom(roomId);
    const peerExisted = room.getPeer(peerId) !== undefined;
    const peer = room.getOrCreatePeer(peerId);

    let transport: WebRtcTransport;

    try {
      transport = await room.router.createWebRtcTransport({
        listenInfos: [
          {
            protocol: 'udp',
            ip: '0.0.0.0',
            announcedAddress: this.webRtcConfig.announcedAddress,
            portRange: this.webRtcConfig.portRange,
          },
          {
            protocol: 'tcp',
            ip: '0.0.0.0',
            announcedAddress: this.webRtcConfig.announcedAddress,
            portRange: this.webRtcConfig.portRange,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });
    } catch (error) {
      // A brand-new peer with nothing else on it yet must not linger forever
      // and block the room from ever being seen as empty.
      if (!peerExisted) {
        room.removePeer(peerId);
      }

      throw error;
    }

    // A concurrent removePeer can delete this peer while the transport was
    // being created - the transport must not attach to an orphaned peer no
    // one holds a reference to.
    if (room.getPeer(peerId) !== peer) {
      transport.close();
      throw new NotFoundException(`Peer ${peerId} not found in room ${roomId}`);
    }

    if (direction === TRANSPORT_DIRECTIONS.SEND) {
      // A retried createTransport call (client timeout, reconnect) must not
      // leak the previous transport's ports/producers.
      peer.sendTransport?.close();
      peer.sendTransport = transport;
    } else {
      peer.recvTransport?.close();
      peer.recvTransport = transport;
    }

    return transport;
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

    // A consumer closes when its producer's peer is removed, but this peer's
    // consumers map isn't told - so a stale id must 404 rather than throw
    // mediasoup's closed-resource error.
    if (!consumer || consumer.closed) {
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

  // A double-leave or a race against closeRoom can call this against an
  // already-unknown room/peer - no-op rather than throw, matching
  // apps/realtime's own mirrored RoomsService.removePeer.
  removePeer(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);

    if (!room) {
      return;
    }

    room.removePeer(peerId);
  }

  // Mirrors apps/realtime's closeRoom: a no-op (but still reports success)
  // if peers remain or the room is already gone, so a caller can call this
  // unconditionally after removePeer without racing a concurrent join.
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

    // A producer closes when its transport is replaced by a retry, but this
    // peer's producers map isn't told - so a stale id must 404, not throw
    // mediasoup's closed-resource error.
    if (!producer || producer.closed) {
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
