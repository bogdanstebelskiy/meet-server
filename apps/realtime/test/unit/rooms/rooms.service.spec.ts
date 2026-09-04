import { Test, TestingModule } from '@nestjs/testing';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';
import { Peer } from '../../../src/rooms/entities/peer.entity';

describe('RoomsService', () => {
  let service: RoomsService;
  let sfuClient: { createOrGetMediaRoom: jest.Mock };

  beforeEach(async () => {
    sfuClient = {
      createOrGetMediaRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: SfuClientService, useValue: sfuClient },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  it('creates a room via the SfuClient and caches its rtpCapabilities', async () => {
    const rtpCapabilities = { codecs: [] };
    sfuClient.createOrGetMediaRoom.mockResolvedValue({
      roomId: 'room-1',
      rtpCapabilities,
    });

    const room = await service.getOrCreateRoom('room-1');

    expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledWith('room-1');
    expect(room.id).toBe('room-1');
    expect(room.rtpCapabilities).toBe(rtpCapabilities);
  });

  it('returns the cached room on subsequent calls instead of calling the SfuClient again', async () => {
    sfuClient.createOrGetMediaRoom.mockResolvedValue({
      roomId: 'room-1',
      rtpCapabilities: {},
    });

    const first = await service.getOrCreateRoom('room-1');
    const second = await service.getOrCreateRoom('room-1');

    expect(first).toBe(second);
    expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent creation for the same brand-new room (no lost peer state)', async () => {
    let resolveMediaRoom!: (value: unknown) => void;
    sfuClient.createOrGetMediaRoom.mockReturnValue(
      new Promise((resolve) => {
        resolveMediaRoom = resolve;
      }),
    );

    // same tick, before either await resolves: neither sees a cached Room yet.
    const call1 = service.getOrCreateRoom('room-1');
    const call2 = service.getOrCreateRoom('room-1');

    resolveMediaRoom({ roomId: 'room-1', rtpCapabilities: {} });
    const [room1, room2] = await Promise.all([call1, call2]);

    expect(room1).toBe(room2);
    expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(1);
  });

  it('getRoom returns undefined for an unknown room', () => {
    expect(service.getRoom('missing')).toBeUndefined();
  });

  it('getPeer returns undefined for an unknown room', () => {
    expect(service.getPeer('missing', 'peer-1')).toBeUndefined();
  });

  it('getPeer returns undefined for an unknown peer in a known room', async () => {
    sfuClient.createOrGetMediaRoom.mockResolvedValue({
      roomId: 'room-1',
      rtpCapabilities: {},
    });

    await service.getOrCreateRoom('room-1');

    expect(service.getPeer('room-1', 'missing')).toBeUndefined();
  });

  it('getPeer returns the peer once it has joined the room', async () => {
    sfuClient.createOrGetMediaRoom.mockResolvedValue({
      roomId: 'room-1',
      rtpCapabilities: {},
    });

    const room = await service.getOrCreateRoom('room-1');
    const peer = new Peer('peer-1', 'Alice');
    room.addPeer(peer);

    expect(service.getPeer('room-1', 'peer-1')).toBe(peer);
  });

  it('closeRoom is a no-op for an unknown room', () => {
    expect(() => service.closeRoom('missing')).not.toThrow();
  });

  it('closeRoom forgets the room', async () => {
    sfuClient.createOrGetMediaRoom.mockResolvedValue({
      roomId: 'room-1',
      rtpCapabilities: {},
    });

    await service.getOrCreateRoom('room-1');
    service.closeRoom('room-1');

    expect(service.getRoom('room-1')).toBeUndefined();
  });

  it('a room closed and then re-requested calls the SfuClient again', async () => {
    sfuClient.createOrGetMediaRoom
      .mockResolvedValueOnce({ roomId: 'room-1', rtpCapabilities: {} })
      .mockResolvedValueOnce({ roomId: 'room-1', rtpCapabilities: {} });

    const first = await service.getOrCreateRoom('room-1');
    service.closeRoom('room-1');
    const second = await service.getOrCreateRoom('room-1');

    expect(second).not.toBe(first);
    expect(sfuClient.createOrGetMediaRoom).toHaveBeenCalledTimes(2);
  });
});
