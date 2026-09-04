import { Injectable } from '@nestjs/common';
import { SfuClientService } from '../sfu-client/sfu-client.service';
import { Room } from './entities/room.entity';
import { Peer } from './entities/peer.entity';

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();
  // Dedupes concurrent getOrCreateRoom calls for a new roomId, so two peers
  // joining at the same instant don't each create their own local Room (and
  // silently drop whichever's peer got added first when the second write wins).
  private readonly pendingRooms = new Map<string, Promise<Room>>();

  constructor(private readonly sfuClient: SfuClientService) {}

  async getOrCreateRoom(roomId: string): Promise<Room> {
    const existing = this.rooms.get(roomId);

    if (existing) {
      return existing;
    }

    const pending = this.pendingRooms.get(roomId);

    if (pending) {
      return pending;
    }

    const creation = this.createRoom(roomId).finally(() =>
      this.pendingRooms.delete(roomId),
    );
    this.pendingRooms.set(roomId, creation);

    return creation;
  }

  private async createRoom(roomId: string): Promise<Room> {
    const { rtpCapabilities } =
      await this.sfuClient.createOrGetMediaRoom(roomId);

    const room = new Room(roomId, rtpCapabilities);
    this.rooms.set(roomId, room);

    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getPeer(roomId: string, peerId: string): Peer | undefined {
    return this.getRoom(roomId)?.peers.get(peerId);
  }

  // Only forgets the Room locally - apps/sfu has no MediaRoom teardown
  // endpoint yet (tracked in #18), so its mediasoup resources leak until
  // that lands.
  closeRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }
}
