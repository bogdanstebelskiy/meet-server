import { Injectable } from '@nestjs/common';
import { SfuService } from '../sfu/sfu.service';
import { mediaCodecs } from '../sfu/config';
import { Room } from './entities/room.entity';

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();
  // Dedupes concurrent getOrCreateRoom calls for a new roomId, so two peers
  // joining at the same instant don't each create their own router.
  private readonly pendingRooms = new Map<string, Promise<Room>>();

  constructor(private readonly sfuService: SfuService) {}

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
    const worker = this.sfuService.getWorker();
    const router = await worker.createRouter({ mediaCodecs });
    this.sfuService.trackRouterCreated(worker);

    const room = new Room(roomId, router, worker);
    this.rooms.set(roomId, room);

    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);

    if (!room) {
      return;
    }

    room.close();
    this.sfuService.trackRouterClosed(room.worker);
    this.rooms.delete(roomId);
  }
}
