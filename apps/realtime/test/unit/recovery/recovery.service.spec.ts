import { RecoveryService } from '../../../src/recovery/recovery.service';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SessionsService } from '../../../src/sessions/sessions.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';
import { BroadcastService } from '../../../src/broadcast/broadcast.service';
import { SfuFailureEmitter } from '../../../src/sfu-client/sfu-failure.emitter';

const instanceUrl = 'http://sfu-instance:3001';

describe('RecoveryService', () => {
  let service: RecoveryService;
  let redis: { set: jest.Mock };
  let roomsService: { resetAllProducers: jest.Mock };
  let sessionsService: { get: jest.Mock; assign: jest.Mock };
  let sfuClient: { createOrGetMediaRoom: jest.Mock };
  let broadcastService: { broadcastToRoom: jest.Mock };
  let sfuFailureEmitter: SfuFailureEmitter;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
    };
    roomsService = {
      resetAllProducers: jest.fn().mockResolvedValue(undefined),
    };
    sessionsService = {
      get: jest.fn().mockResolvedValue(instanceUrl),
      assign: jest.fn().mockResolvedValue(instanceUrl),
    };
    sfuClient = {
      createOrGetMediaRoom: jest.fn().mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      }),
    };
    broadcastService = {
      broadcastToRoom: jest.fn(),
    };
    sfuFailureEmitter = new SfuFailureEmitter();

    service = new RecoveryService(
      redis as any,
      roomsService as unknown as RoomsService,
      sessionsService as unknown as SessionsService,
      sfuClient as unknown as SfuClientService,
      broadcastService as unknown as BroadcastService,
      sfuFailureEmitter,
    );
  });

  describe('recover', () => {
    it('acquires a per-room lock before doing anything', async () => {
      await service.recover('room-1', 'unreachable');

      expect(redis.set).toHaveBeenCalledWith(
        'recovery:room-1',
        '1',
        'EX',
        10,
        'NX',
      );
    });

    it('skips recovery entirely when the lock is already held', async () => {
      redis.set.mockResolvedValue(null);

      await service.recover('room-1', 'unreachable');

      expect(sfuClient.createOrGetMediaRoom).not.toHaveBeenCalled();
      expect(roomsService.resetAllProducers).not.toHaveBeenCalled();
      expect(broadcastService.broadcastToRoom).not.toHaveBeenCalled();
    });

    it('recreates the MediaRoom on the already-pinned instance when a session still exists', async () => {
      await service.recover('room-1', 'not-found');

      expect(sessionsService.assign).not.toHaveBeenCalled();
      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledWith(
        instanceUrl,
        'room-1',
      );
    });

    it('reassigns the session first when the pinned instance is actually gone', async () => {
      sessionsService.get.mockResolvedValue(undefined);
      sessionsService.assign.mockResolvedValue('http://sfu-fresh:3001');

      await service.recover('room-1', 'unreachable');

      expect(sessionsService.assign).toHaveBeenCalledWith('room-1');
      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledWith(
        'http://sfu-fresh:3001',
        'room-1',
      );
    });

    it('resets producer records but never touches room membership', async () => {
      await service.recover('room-1', 'unreachable');

      expect(roomsService.resetAllProducers).toHaveBeenCalledWith('room-1');
    });

    it('broadcasts a room-wide recovery event once recovery completes', async () => {
      await service.recover('room-1', 'unreachable');

      expect(broadcastService.broadcastToRoom).toHaveBeenCalledWith(
        'room-1',
        'roomRecovered',
        { roomId: 'room-1' },
      );
    });

    it('does not broadcast when recreating the MediaRoom fails', async () => {
      sfuClient.createOrGetMediaRoom.mockRejectedValue(
        new Error('sfu still unreachable'),
      );

      await expect(service.recover('room-1', 'unreachable')).rejects.toThrow(
        'sfu still unreachable',
      );

      expect(broadcastService.broadcastToRoom).not.toHaveBeenCalled();
    });
  });

  describe('sfu failure subscription', () => {
    it('recovers a room once its sfu failure is reported', async () => {
      service.onModuleInit();

      sfuFailureEmitter.emit('failure', {
        roomId: 'room-1',
        reason: 'unreachable',
      });
      // Let the async recover() triggered by emit() settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledWith(
        instanceUrl,
        'room-1',
      );
    });
  });
});
