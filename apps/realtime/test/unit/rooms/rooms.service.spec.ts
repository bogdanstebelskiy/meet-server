import { Test, TestingModule } from '@nestjs/testing';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';
import { REDIS_CLIENT } from '../../../src/redis/redis.provider';
import { FakeRedis } from '../fakes/fake-redis';

describe('RoomsService', () => {
  let service: RoomsService;
  let redis: FakeRedis;
  let sfuClient: { createOrGetMediaRoom: jest.Mock };

  beforeEach(async () => {
    redis = new FakeRedis();
    sfuClient = {
      createOrGetMediaRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SfuClientService, useValue: sfuClient },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  describe('getOrCreateRoom', () => {
    it('creates a room via the SfuClient and persists its rtpCapabilities', async () => {
      const rtpCapabilities = { codecs: [] };
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities,
      });

      const room = await service.getOrCreateRoom('room-1');

      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledWith('room-1');
      expect(room).toEqual({ id: 'room-1', rtpCapabilities });
      expect(await redis.get('room:room-1')).toBe(JSON.stringify(room));
    });

    it('sets a TTL on the room key', async () => {
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      });

      await service.getOrCreateRoom('room-1');

      expect(redis.ttlOf('room:room-1')).toBe(60 * 60 * 24);
    });

    it('returns the persisted room on subsequent calls instead of calling the SfuClient again', async () => {
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      });

      await service.getOrCreateRoom('room-1');
      await service.getOrCreateRoom('room-1');

      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(1);
    });

    it('refreshes the room key TTL on every call, not just on creation', async () => {
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      });
      const expireSpy = jest.spyOn(redis, 'expire');

      await service.getOrCreateRoom('room-1');
      expireSpy.mockClear();
      await service.getOrCreateRoom('room-1');

      expect(expireSpy).toHaveBeenCalledWith('room:room-1', 60 * 60 * 24);
    });

    it('dedupes concurrent creation for the same brand-new room (no lost peer state)', async () => {
      let resolveMediaRoom!: (value: unknown) => void;
      sfuClient.createOrGetMediaRoom.mockReturnValue(
        new Promise((resolve) => {
          resolveMediaRoom = resolve;
        }),
      );

      // same tick, before either await resolves: neither sees a persisted
      // room yet.
      const call1 = service.getOrCreateRoom('room-1');
      const call2 = service.getOrCreateRoom('room-1');

      resolveMediaRoom({ roomId: 'room-1', rtpCapabilities: {} });
      const [room1, room2] = await Promise.all([call1, call2]);

      expect(room1).toEqual(room2);
      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRoom', () => {
    it('returns undefined for an unknown room', async () => {
      expect(await service.getRoom('missing')).toBeUndefined();
    });
  });

  describe('getPeer / getOtherPeers', () => {
    it('getPeer returns undefined for an unknown room', async () => {
      expect(await service.getPeer('missing', 'peer-1')).toBeUndefined();
    });

    it('getPeer returns undefined for an unknown peer in a known room', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });

      expect(await service.getPeer('room-1', 'missing')).toBeUndefined();
    });

    it('getPeer returns the peer once it has joined the room', async () => {
      const peer = { id: 'peer-1', displayName: 'Alice' };
      await service.addPeer('room-1', peer);

      expect(await service.getPeer('room-1', 'peer-1')).toEqual(peer);
    });

    it('addPeer sets a TTL on the room peers hash', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });

      expect(redis.ttlOf('room:room-1:peers')).toBe(60 * 60 * 24);
    });

    it('getOtherPeers excludes the given peer id', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });
      await service.addPeer('room-1', { id: 'peer-2', displayName: 'Bob' });

      expect(await service.getOtherPeers('room-1', 'peer-1')).toEqual([
        { id: 'peer-2', displayName: 'Bob' },
      ]);
    });

    it('getOtherPeers returns everyone when the given id is not in the room', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });

      expect(await service.getOtherPeers('room-1', 'never-joined')).toEqual([
        { id: 'peer-1', displayName: 'Alice' },
      ]);
    });
  });

  describe('removePeer / isEmpty / closeRoom', () => {
    it('removePeer is a no-op for an unknown peer id, not a throw', async () => {
      await expect(
        service.removePeer('room-1', 'missing'),
      ).resolves.not.toThrow();
    });

    it('removes the peer but leaves the room non-empty while others remain', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });
      await service.addPeer('room-1', { id: 'peer-2', displayName: 'Bob' });

      await service.removePeer('room-1', 'peer-1');

      expect(await service.getPeer('room-1', 'peer-1')).toBeUndefined();
      expect(await service.isEmpty('room-1')).toBe(false);
    });

    it('isEmpty is true once the last peer is removed', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });

      await service.removePeer('room-1', 'peer-1');

      expect(await service.isEmpty('room-1')).toBe(true);
    });

    it('removePeer deletes that peer producers hash', async () => {
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });
      await service.addProducer('room-1', 'peer-1', 'prod-1', 'audio');

      await service.removePeer('room-1', 'peer-1');

      expect(await service.getProducers('room-1', 'peer-1')).toEqual([]);
    });

    it('closeRoom is a no-op for an unknown room, but reports it closed', async () => {
      await expect(service.closeRoom('missing')).resolves.toBe(true);
    });

    it('closeRoom forgets the room, its peers, and their producers, and reports it closed', async () => {
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      });
      await service.getOrCreateRoom('room-1');
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });
      await service.addProducer('room-1', 'peer-1', 'prod-1', 'audio');
      await service.removePeer('room-1', 'peer-1');

      await expect(service.closeRoom('room-1')).resolves.toBe(true);

      expect(await service.getRoom('room-1')).toBeUndefined();
      expect(await service.getPeer('room-1', 'peer-1')).toBeUndefined();
      expect(await service.getProducers('room-1', 'peer-1')).toEqual([]);
    });

    it('does not wipe a peer that joins between the emptiness check and the delete, and reports it did not close (issue #24)', async () => {
      sfuClient.createOrGetMediaRoom.mockResolvedValue({
        roomId: 'room-1',
        rtpCapabilities: {},
      });
      await service.getOrCreateRoom('room-1');
      await service.addPeer('room-1', { id: 'peer-1', displayName: 'Alice' });
      await service.removePeer('room-1', 'peer-1');

      // closeRoom reads hkeys before its atomic check-and-delete - inject the
      // race by having a new peer join as a side effect of that read, before
      // the delete itself runs.
      const originalHkeys = redis.hkeys.bind(redis);
      jest.spyOn(redis, 'hkeys').mockImplementationOnce(async (key) => {
        await service.addPeer('room-1', { id: 'peer-2', displayName: 'Bob' });
        return originalHkeys(key);
      });

      await expect(service.closeRoom('room-1')).resolves.toBe(false);

      expect(await service.getRoom('room-1')).toEqual({
        id: 'room-1',
        rtpCapabilities: {},
      });
      expect(await service.getPeer('room-1', 'peer-2')).toEqual({
        id: 'peer-2',
        displayName: 'Bob',
      });
    });

    it('a room closed and then re-requested calls the SfuClient again', async () => {
      sfuClient.createOrGetMediaRoom
        .mockResolvedValueOnce({ roomId: 'room-1', rtpCapabilities: {} })
        .mockResolvedValueOnce({ roomId: 'room-1', rtpCapabilities: {} });

      await service.getOrCreateRoom('room-1');
      await service.closeRoom('room-1');
      await service.getOrCreateRoom('room-1');

      expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(2);
    });
  });

  describe('producers', () => {
    it('getProducers returns empty for a peer with no producers', async () => {
      expect(await service.getProducers('room-1', 'peer-1')).toEqual([]);
    });

    it('addProducer records producers, retrievable via getProducers', async () => {
      await service.addProducer('room-1', 'peer-1', 'prod-audio', 'audio');
      await service.addProducer('room-1', 'peer-1', 'prod-video', 'video');

      expect(await service.getProducers('room-1', 'peer-1')).toEqual(
        expect.arrayContaining([
          { producerId: 'prod-audio', kind: 'audio' },
          { producerId: 'prod-video', kind: 'video' },
        ]),
      );
    });

    it('addProducer sets a TTL on the peer producers hash', async () => {
      await service.addProducer('room-1', 'peer-1', 'prod-1', 'audio');

      expect(redis.ttlOf('peer:room-1:peer-1:producers')).toBe(60 * 60 * 24);
    });
  });
});
