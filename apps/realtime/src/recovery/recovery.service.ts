import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoomsService } from '../rooms/rooms.service';
import { SessionsService } from '../sessions/sessions.service';
import { SfuClientService } from '../sfu-client/sfu-client.service';
import { SfuFailureEmitter } from '../sfu-client/sfu-failure.emitter';
import { SFU_FAILURE_EVENT } from '../sfu-client/constants';
import { BroadcastService } from '../broadcast/broadcast.service';
import { ROOM_RECOVERED_EVENT } from './constants';
import type { SfuFailureEvent, SfuFailureReason } from '../sfu-client/types';

// Reactive recovery (issue #34): a room's pinned sfu instance dying or
// losing its MediaRoom mid-call otherwise leaves that room repeat-failing
// until every peer leaves and someone rejoins fresh. This listens for
// SfuClientService's failure signal and recreates the room in the
// background - the call that triggered detection still fails (see
// SfuClientService), only the next one succeeds.
@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly roomsService: RoomsService,
    private readonly sessionsService: SessionsService,
    private readonly sfuClient: SfuClientService,
    private readonly broadcastService: BroadcastService,
    private readonly sfuFailureEmitter: SfuFailureEmitter,
  ) {}

  onModuleInit(): void {
    this.sfuFailureEmitter.on(SFU_FAILURE_EVENT, (event: SfuFailureEvent) => {
      this.recover(event.roomId, event.reason).catch((error) =>
        this.logger.error(
          `Failed to recover media room ${event.roomId}`,
          error,
        ),
      );
    });
  }

  async recover(roomId: string, reason: SfuFailureReason): Promise<void> {
    const acquired = await this.sessionsService.tryLockReassignment(roomId);

    if (!acquired) {
      return;
    }

    this.logger.warn(`Recovering media room ${roomId} after: ${reason}`);

    // Only reassign if the pinned instance is actually gone (session
    // already invalidated for the unreachable case) - a 404 on an instance
    // that's still reachable just needs its MediaRoom recreated in place.
    let instanceUrl = await this.sessionsService.get(roomId);

    if (!instanceUrl) {
      instanceUrl = await this.sessionsService.assign(roomId);
    }

    await this.sfuClient.createOrGetMediaRoom(instanceUrl, roomId);
    await this.roomsService.resetAllProducers(roomId);

    this.broadcastService.broadcastToRoom(roomId, ROOM_RECOVERED_EVENT, {
      roomId,
    });
  }
}
