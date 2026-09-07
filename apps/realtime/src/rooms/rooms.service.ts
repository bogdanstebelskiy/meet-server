import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { MediaKind } from 'mediasoup/types';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { SfuClientService } from '../sfu-client/sfu-client.service';
import { SfuRegistryService } from '../sfu-client/sfu-registry.service';
import { ROOM_TTL_SECONDS } from './constants';
import { Room, Peer, RoomProducer } from './types';

@Injectable()
export class RoomsService {
  // Same-process-only optimization: collapses concurrent getOrCreateRoom
  // calls for a brand-new room within this instance, saving a redundant
  // sfu/Redis round-trip. Not a correctness mechanism and has no effect
  // across instances - two instances racing on the same new roomId still
  // converge, because sfuClient.createOrGetMediaRoom is create-or-get keyed
  // by roomId and writing the same room metadata to Redis twice is harmless.
  private readonly pendingRooms = new Map<string, Promise<Room>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sfuClient: SfuClientService,
    private readonly sfuRegistry: SfuRegistryService,
  ) {}

  async getOrCreateRoom(roomId: string): Promise<Room> {
    const existing = await this.getRoom(roomId);
    if (existing) {
      // Refresh on every join, same as addPeer/addProducer do for their own
      // keys - otherwise this key expires on schedule even under a room
      // with continuous activity, while the peers/producers hashes (kept
      // alive by those refreshes) don't, splitting one room's state across
      // two different lifetimes.
      const roomKey = this.roomKey(roomId);
      await this.redis.expire(roomKey, ROOM_TTL_SECONDS);
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

  async getRoom(roomId: string): Promise<Room | undefined> {
    const roomKey = this.roomKey(roomId);
    const raw = await this.redis.get(roomKey);

    if (raw) {
      return JSON.parse(raw) as Room;
    }
  }

  async getPeer(roomId: string, peerId: string): Promise<Peer | undefined> {
    const peersKey = this.peersKey(roomId);
    const raw = await this.redis.hget(peersKey, peerId);

    if (raw) {
      return JSON.parse(raw) as Peer;
    }
  }

  async getOtherPeers(roomId: string, excludePeerId: string): Promise<Peer[]> {
    const peersKey = this.peersKey(roomId);
    const all = await this.redis.hgetall(peersKey);

    const entries = Object.entries(all);
    const otherPeerEntries = entries.filter(([peerId]) => peerId !== excludePeerId);
    const otherPeers = otherPeerEntries.map(([, raw]) => JSON.parse(raw) as Peer);

    return otherPeers;
  }

  async addPeer(roomId: string, peer: Peer): Promise<void> {
    const peersKey = this.peersKey(roomId);
    const serializedPeer = JSON.stringify(peer);
    await this.redis.hset(peersKey, peer.id, serializedPeer);
    await this.redis.expire(peersKey, ROOM_TTL_SECONDS);
  }

  // Sequential, best-effort (no MULTI/Lua transaction): a crash between
  // these two deletes can orphan the producers hash, which its own TTL
  // cleans up - see the room/peer/producer keys' shared TTL rationale below.
  // Only forgets the Peer here - apps/sfu teardown (removePeer/closeRoom) is
  // a separate call, made by SignalingService.leave() right after this.
  async removePeer(roomId: string, peerId: string): Promise<void> {
    const peersKey = this.peersKey(roomId);
    await this.redis.hdel(peersKey, peerId);

    const producersKey = this.producersKey(roomId, peerId);
    await this.redis.del(producersKey);
  }

  async isEmpty(roomId: string): Promise<boolean> {
    const peersKey = this.peersKey(roomId);
    const count = await this.redis.hlen(peersKey);
    return count === 0;
  }

  // A crashed instance never fires this, so a dead peer lingers until #7's
  // TTL/liveness work lands - TTLs below are the safety net for now.
  // The join-during-close race (#24) is closed by closeRoomIfEmpty (a Lua
  // script, see redis-scripts.ts): it re-checks and deletes the peers hash
  // in one atomic server-side step.
  async closeRoom(roomId: string): Promise<boolean> {
    const peersKey = this.peersKey(roomId);
    const peerIds = await this.redis.hkeys(peersKey);

    const roomKey = this.roomKey(roomId);
    const closed = await this.redis.closeRoomIfEmpty(peersKey, roomKey);

    if (!closed) {
      return false;
    }

    const deleteProducerPromises = peerIds.map((peerId) => {
      const producersKey = this.producersKey(roomId, peerId);
      return this.redis.del(producersKey);
    });
    await Promise.all(deleteProducerPromises);

    return true;
  }

  async addProducer(
    roomId: string,
    peerId: string,
    producerId: string,
    kind: MediaKind,
  ): Promise<void> {
    const producersKey = this.producersKey(roomId, peerId);
    await this.redis.hset(producersKey, producerId, kind);
    await this.redis.expire(producersKey, ROOM_TTL_SECONDS);
  }

  async getProducers(roomId: string, peerId: string): Promise<RoomProducer[]> {
    const producersKey = this.producersKey(roomId, peerId);
    const all = await this.redis.hgetall(producersKey);

    const entries = Object.entries(all);
    const producers = entries.map(([producerId, kind]) => ({
      producerId,
      kind: kind as MediaKind,
    }));

    return producers;
  }

  private async createRoom(roomId: string): Promise<Room> {
    const sfuNodeUrl = await this.sfuRegistry.pickLeastLoaded();
    const { rtpCapabilities } = await this.sfuClient.createOrGetMediaRoom(sfuNodeUrl, roomId);
    const room: Room = { id: roomId, rtpCapabilities, sfuNodeUrl };

    const roomKey = this.roomKey(roomId);
    const serializedRoom = JSON.stringify(room);
    await this.redis.set(roomKey, serializedRoom, 'EX', ROOM_TTL_SECONDS);

    return room;
  }

  private roomKey(roomId: string): string {
    return `room:${roomId}`;
  }

  private peersKey(roomId: string): string {
    return `room:${roomId}:peers`;
  }

  private producersKey(roomId: string, peerId: string): string {
    return `peer:${roomId}:${peerId}:producers`;
  }
}
