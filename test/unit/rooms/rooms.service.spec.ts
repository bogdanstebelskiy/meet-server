import { Test, TestingModule } from '@nestjs/testing';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SfuService } from '../../../src/sfu/sfu.service';
import { Peer } from '../../../src/rooms/entities/peer.entity';

describe('RoomsService', () => {
  let service: RoomsService;
  let sfuService: {
    getWorker: jest.Mock;
    trackRouterCreated: jest.Mock;
    trackRouterClosed: jest.Mock;
  };

  const createFakeWorker = () => ({ createRouter: jest.fn() });

  beforeEach(async () => {
    sfuService = {
      getWorker: jest.fn(),
      trackRouterCreated: jest.fn(),
      trackRouterClosed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoomsService, { provide: SfuService, useValue: sfuService }],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  it('creates a room via a worker from SfuService and reports the router back', async () => {
    const worker = createFakeWorker();
    const router = { close: jest.fn() };
    worker.createRouter.mockResolvedValue(router);
    sfuService.getWorker.mockReturnValue(worker);

    const room = await service.getOrCreateRoom('room-1');

    expect(sfuService.getWorker).toHaveBeenCalledTimes(1);
    expect(worker.createRouter).toHaveBeenCalledWith({
      mediaCodecs: expect.any(Array),
    });
    expect(sfuService.trackRouterCreated).toHaveBeenCalledWith(worker);
    expect(room.id).toBe('room-1');
    expect(room.router).toBe(router);
  });

  it('returns the cached room on subsequent calls instead of creating another router', async () => {
    const worker = createFakeWorker();
    worker.createRouter.mockResolvedValue({ close: jest.fn() });
    sfuService.getWorker.mockReturnValue(worker);

    const first = await service.getOrCreateRoom('room-1');
    const second = await service.getOrCreateRoom('room-1');

    expect(first).toBe(second);
    expect(sfuService.getWorker).toHaveBeenCalledTimes(1);
    expect(worker.createRouter).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent creation for the same brand-new room (no leaked router)', async () => {
    const worker = createFakeWorker();
    let resolveRouter!: (value: unknown) => void;
    worker.createRouter.mockReturnValue(
      new Promise((resolve) => {
        resolveRouter = resolve;
      }),
    );
    sfuService.getWorker.mockReturnValue(worker);

    // same tick, before either await resolves: neither sees a cached Room yet.
    const call1 = service.getOrCreateRoom('room-1');
    const call2 = service.getOrCreateRoom('room-1');

    resolveRouter({ close: jest.fn() });
    const [room1, room2] = await Promise.all([call1, call2]);

    expect(room1).toBe(room2);
    expect(sfuService.getWorker).toHaveBeenCalledTimes(1);
    expect(worker.createRouter).toHaveBeenCalledTimes(1);
    expect(sfuService.trackRouterCreated).toHaveBeenCalledTimes(1);
  });

  it('getRoom returns undefined for an unknown room', () => {
    expect(service.getRoom('missing')).toBeUndefined();
  });

  it('getPeer returns undefined for an unknown room', () => {
    expect(service.getPeer('missing', 'peer-1')).toBeUndefined();
  });

  it('getPeer returns undefined for an unknown peer in a known room', async () => {
    const worker = createFakeWorker();
    worker.createRouter.mockResolvedValue({ close: jest.fn() });
    sfuService.getWorker.mockReturnValue(worker);

    await service.getOrCreateRoom('room-1');

    expect(service.getPeer('room-1', 'missing')).toBeUndefined();
  });

  it('getPeer returns the peer once it has joined the room', async () => {
    const worker = createFakeWorker();
    worker.createRouter.mockResolvedValue({ close: jest.fn() });
    sfuService.getWorker.mockReturnValue(worker);

    const room = await service.getOrCreateRoom('room-1');
    const peer = new Peer('peer-1', 'Alice');
    room.addPeer(peer);

    expect(service.getPeer('room-1', 'peer-1')).toBe(peer);
  });

  it('closeRoom is a no-op for an unknown room', () => {
    expect(() => service.closeRoom('missing')).not.toThrow();
    expect(sfuService.trackRouterClosed).not.toHaveBeenCalled();
  });

  it('closeRoom closes the router, reports back to SfuService, and forgets the room', async () => {
    const worker = createFakeWorker();
    const router = { close: jest.fn() };
    worker.createRouter.mockResolvedValue(router);
    sfuService.getWorker.mockReturnValue(worker);

    await service.getOrCreateRoom('room-1');
    service.closeRoom('room-1');

    expect(router.close).toHaveBeenCalledTimes(1);
    expect(sfuService.trackRouterClosed).toHaveBeenCalledWith(worker);
    expect(service.getRoom('room-1')).toBeUndefined();
  });

  it('a room closed and then re-requested creates a fresh router', async () => {
    const worker = createFakeWorker();
    worker.createRouter
      .mockResolvedValueOnce({ close: jest.fn() })
      .mockResolvedValueOnce({ close: jest.fn() });
    sfuService.getWorker.mockReturnValue(worker);

    const first = await service.getOrCreateRoom('room-1');
    service.closeRoom('room-1');
    const second = await service.getOrCreateRoom('room-1');

    expect(second).not.toBe(first);
    expect(worker.createRouter).toHaveBeenCalledTimes(2);
  });
});
