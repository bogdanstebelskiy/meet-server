import { NotFoundException } from '@nestjs/common';
import { MediaRoomsService } from '../../../src/media-rooms/media-rooms.service';
import { WorkerPoolService } from '../../../src/workers/worker-pool.service';
import { WebRtcConfigService } from '../../../src/config/webrtc-config.service';
import { MediaCodecsConfigService } from '../../../src/config/media-codecs-config.service';

describe('MediaRoomsService', () => {
  let service: MediaRoomsService;
  let workerPool: {
    reserveWorker: jest.Mock;
    trackRouterClosed: jest.Mock;
  };
  let webRtcConfig: {
    announcedAddress: string;
    portRange: unknown;
    webRtcTransportOptions: unknown;
  };
  let mediaCodecsConfig: { codecs: unknown };
  let router: {
    rtpCapabilities: unknown;
    createWebRtcTransport: jest.Mock;
    canConsume: jest.Mock;
    close: jest.Mock;
  };

  const createFakeWorker = () => ({ createRouter: jest.fn() });

  beforeEach(() => {
    router = {
      rtpCapabilities: { codecs: [] },
      createWebRtcTransport: jest.fn(),
      canConsume: jest.fn().mockReturnValue(true),
      close: jest.fn(),
    };

    workerPool = {
      reserveWorker: jest.fn(),
      trackRouterClosed: jest.fn(),
    };

    webRtcConfig = {
      announcedAddress: '127.0.0.1',
      portRange: { min: 40000, max: 49999 },
      webRtcTransportOptions: {
        listenInfos: [
          { protocol: 'udp', ip: '0.0.0.0', announcedAddress: '127.0.0.1' },
          { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: '127.0.0.1' },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      },
    };

    mediaCodecsConfig = {
      codecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000 }],
    };

    service = new MediaRoomsService(
      workerPool as unknown as WorkerPoolService,
      webRtcConfig as unknown as WebRtcConfigService,
      mediaCodecsConfig as unknown as MediaCodecsConfigService,
    );
  });

  function stubWorkerCreatingRouter() {
    const worker = createFakeWorker();
    worker.createRouter.mockResolvedValue(router);
    workerPool.reserveWorker.mockReturnValue(worker);

    return worker;
  }

  describe('getOrCreateRoom', () => {
    it('creates a room via a worker from the pool and reports the router back', async () => {
      const worker = stubWorkerCreatingRouter();

      const room = await service.getOrCreateRoom('room-1');

      expect(workerPool.reserveWorker).toHaveBeenCalledTimes(1);
      expect(worker.createRouter).toHaveBeenCalledWith({
        mediaCodecs: expect.any(Array),
      });
      expect(room.id).toBe('room-1');
      expect(room.router).toBe(router);
    });

    it('returns the cached room on subsequent calls instead of creating another router', async () => {
      const worker = stubWorkerCreatingRouter();

      const first = await service.getOrCreateRoom('room-1');
      const second = await service.getOrCreateRoom('room-1');

      expect(first).toBe(second);
      expect(workerPool.reserveWorker).toHaveBeenCalledTimes(1);
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
      workerPool.reserveWorker.mockReturnValue(worker);

      const call1 = service.getOrCreateRoom('room-1');
      const call2 = service.getOrCreateRoom('room-1');

      resolveRouter(router);
      const [room1, room2] = await Promise.all([call1, call2]);

      expect(room1).toBe(room2);
      expect(workerPool.reserveWorker).toHaveBeenCalledTimes(1);
      expect(worker.createRouter).toHaveBeenCalledTimes(1);
    });

    it('releases the reserved worker slot and does not cache the room when createRouter rejects', async () => {
      const worker = createFakeWorker();
      const error = new Error('router creation failed');
      worker.createRouter.mockRejectedValue(error);
      workerPool.reserveWorker.mockReturnValue(worker);

      await expect(service.getOrCreateRoom('room-1')).rejects.toThrow(error);

      expect(workerPool.trackRouterClosed).toHaveBeenCalledWith(worker);
      expect(() => service.getRoom('room-1')).toThrow(NotFoundException);
    });
  });

  describe('getRoom / getPeer', () => {
    it('throws NotFoundException for an unknown room', () => {
      expect(() => service.getRoom('missing')).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown peer in a known room', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');

      expect(() => service.getPeer('room-1', 'missing')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('staleness tracking', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('touches the room on getRoom access', async () => {
      stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      const room = await service.getOrCreateRoom('room-1');

      jest.setSystemTime(5000);
      service.getRoom('room-1');

      expect(room.lastActivityAt).toBe(5000);
    });

    it('touches an already-cached room on a repeated getOrCreateRoom call', async () => {
      const worker = stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      const room = await service.getOrCreateRoom('room-1');

      jest.setSystemTime(6000);
      await service.getOrCreateRoom('room-1');

      expect(room.lastActivityAt).toBe(6000);
      expect(worker.createRouter).toHaveBeenCalledTimes(1);
    });

    it('touches the room on removePeer, even for a peer that is not found', async () => {
      stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      const room = await service.getOrCreateRoom('room-1');

      jest.setSystemTime(7000);
      service.removePeer('room-1', 'ghost');

      expect(room.lastActivityAt).toBe(7000);
    });
  });

  describe('createTransport', () => {
    it('creates and assigns sendTransport for direction "send", lazily creating the peer', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');
      const transport = { id: 't1' };
      router.createWebRtcTransport.mockResolvedValue(transport);

      const result = await service.createTransport('room-1', 'peer-1', 'send');

      expect(result).toBe(transport);
      expect(service.getPeer('room-1', 'peer-1').sendTransport).toBe(transport);
      expect(router.createWebRtcTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          listenInfos: expect.arrayContaining([
            expect.objectContaining({ announcedAddress: '127.0.0.1' }),
          ]),
        }),
      );
    });

    it('creates and assigns recvTransport for direction "recv"', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');
      const transport = { id: 't2' };
      router.createWebRtcTransport.mockResolvedValue(transport);

      await service.createTransport('room-1', 'peer-1', 'recv');

      expect(service.getPeer('room-1', 'peer-1').recvTransport).toBe(transport);
    });

    it('forgets a brand-new peer if createWebRtcTransport rejects, so the room can still become empty', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');
      const error = new Error('transport creation failed');
      router.createWebRtcTransport.mockRejectedValue(error);

      await expect(
        service.createTransport('room-1', 'peer-1', 'send'),
      ).rejects.toThrow(error);

      expect(() => service.getPeer('room-1', 'peer-1')).toThrow(
        NotFoundException,
      );
    });

    it('keeps an already-known peer around if createWebRtcTransport rejects on a second call', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const existingTransport = { id: 't1' };
      router.createWebRtcTransport.mockResolvedValue(existingTransport);
      await service.createTransport('room-1', 'peer-1', 'send');

      const error = new Error('transport creation failed');
      router.createWebRtcTransport.mockRejectedValue(error);

      await expect(
        service.createTransport('room-1', 'peer-1', 'recv'),
      ).rejects.toThrow(error);

      expect(room.getPeer('peer-1')?.sendTransport).toBe(existingTransport);
    });

    it('closes the transport and 404s if the peer is removed while createWebRtcTransport is pending', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');
      const transport = { id: 't1', close: jest.fn() };
      let resolveTransport!: (value: typeof transport) => void;
      router.createWebRtcTransport.mockReturnValue(
        new Promise((resolve) => {
          resolveTransport = resolve;
        }),
      );

      const creation = service.createTransport('room-1', 'peer-1', 'send');
      service.removePeer('room-1', 'peer-1');
      resolveTransport(transport);

      await expect(creation).rejects.toThrow(NotFoundException);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('connectTransport', () => {
    it('connects the matching transport by id', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const transport = { id: 't1', connect: jest.fn() };
      peer.sendTransport = transport as any;

      await service.connectTransport('room-1', 'peer-1', 't1', {
        role: 'client',
      } as any);

      expect(transport.connect).toHaveBeenCalledWith({
        dtlsParameters: { role: 'client' },
      });
    });

    it('throws NotFoundException when transportId matches neither send nor recv transport', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      await expect(
        service.connectTransport('room-1', 'peer-1', 'unknown', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('produce', () => {
    it('produces on the peer send transport and stores the producer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const producer = { id: 'prod-1' };
      const transport = {
        id: 't1',
        produce: jest.fn().mockResolvedValue(producer),
      };
      peer.sendTransport = transport as any;

      const result = await service.produce(
        'room-1',
        'peer-1',
        't1',
        'audio',
        {} as any,
      );

      expect(result).toBe(producer);
      expect(peer.producers.get('prod-1')).toBe(producer);
    });

    it('throws NotFoundException when the peer never created a send transport', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      await expect(
        service.produce('room-1', 'peer-1', 't1', 'audio', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('consume', () => {
    it('consumes paused on the peer recv transport and stores the consumer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const consumer = { id: 'cons-1' };
      const transport = {
        id: 't2',
        consume: jest.fn().mockResolvedValue(consumer),
      };
      peer.recvTransport = transport as any;

      const result = await service.consume('room-1', 'peer-1', 'prod-1', {});

      expect(result).toBe(consumer);
      expect(transport.consume).toHaveBeenCalledWith({
        producerId: 'prod-1',
        rtpCapabilities: {},
        paused: true,
      });
      expect(peer.consumers.get('cons-1')).toBe(consumer);
    });

    it('throws NotFoundException when the router says the capabilities cannot consume', async () => {
      stubWorkerCreatingRouter();
      router.canConsume.mockReturnValue(false);
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      peer.recvTransport = { consume: jest.fn() } as any;

      await expect(
        service.consume('room-1', 'peer-1', 'prod-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the peer has no recv transport yet', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      await expect(
        service.consume('room-1', 'peer-1', 'prod-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resumeConsumer', () => {
    it('resumes a known consumer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const consumer = { resume: jest.fn() };
      peer.consumers.set('cons-1', consumer as any);

      await service.resumeConsumer('room-1', 'peer-1', 'cons-1');

      expect(consumer.resume).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for an unknown consumer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      await expect(
        service.resumeConsumer('room-1', 'peer-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException for a consumer left closed by its producer's peer being removed", async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const consumer = { closed: true, resume: jest.fn() };
      peer.consumers.set('cons-1', consumer as any);

      await expect(
        service.resumeConsumer('room-1', 'peer-1', 'cons-1'),
      ).rejects.toThrow(NotFoundException);
      expect(consumer.resume).not.toHaveBeenCalled();
    });
  });

  describe('pauseProducer / resumeProducer', () => {
    it('pauses a known producer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const producer = { pause: jest.fn(), resume: jest.fn() };
      peer.producers.set('prod-1', producer as any);

      await service.pauseProducer('room-1', 'peer-1', 'prod-1');

      expect(producer.pause).toHaveBeenCalledTimes(1);
    });

    it('resumes a known producer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const producer = { pause: jest.fn(), resume: jest.fn() };
      peer.producers.set('prod-1', producer as any);

      await service.resumeProducer('room-1', 'peer-1', 'prod-1');

      expect(producer.resume).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for an unknown producer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      await expect(
        service.pauseProducer('room-1', 'peer-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a producer left closed by its transport being replaced', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const producer = { closed: true, pause: jest.fn(), resume: jest.fn() };
      peer.producers.set('prod-1', producer as any);

      await expect(
        service.pauseProducer('room-1', 'peer-1', 'prod-1'),
      ).rejects.toThrow(NotFoundException);
      expect(producer.pause).not.toHaveBeenCalled();
    });
  });

  describe('removePeer', () => {
    it('closes the peer send and recv transports and forgets the peer', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      const peer = room.getOrCreatePeer('peer-1');
      const sendTransport = { close: jest.fn() };
      const recvTransport = { close: jest.fn() };
      peer.sendTransport = sendTransport as any;
      peer.recvTransport = recvTransport as any;

      service.removePeer('room-1', 'peer-1');

      expect(sendTransport.close).toHaveBeenCalledTimes(1);
      expect(recvTransport.close).toHaveBeenCalledTimes(1);
      expect(() => service.getPeer('room-1', 'peer-1')).toThrow(
        NotFoundException,
      );
    });

    it('no-ops for an unknown peer, so a double-leave race stays quiet', async () => {
      stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');

      expect(() => service.removePeer('room-1', 'missing')).not.toThrow();
    });

    it('no-ops for an unknown room, so a race against closeRoom stays quiet', () => {
      expect(() => service.removePeer('missing', 'peer-1')).not.toThrow();
    });
  });

  describe('closeRoom', () => {
    it('closes the router and reports the freed worker slot once the room is empty', async () => {
      const worker = stubWorkerCreatingRouter();
      await service.getOrCreateRoom('room-1');

      const closed = service.closeRoom('room-1');

      expect(closed).toBe(true);
      expect(router.close).toHaveBeenCalledTimes(1);
      expect(workerPool.trackRouterClosed).toHaveBeenCalledWith(worker);
      expect(() => service.getRoom('room-1')).toThrow(NotFoundException);
    });

    it('does not close the router while peers remain', async () => {
      stubWorkerCreatingRouter();
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      const closed = service.closeRoom('room-1');

      expect(closed).toBe(false);
      expect(router.close).not.toHaveBeenCalled();
      expect(workerPool.trackRouterClosed).not.toHaveBeenCalled();
      expect(service.getRoom('room-1')).toBe(room);
    });

    it('reports already closed for an unknown room, so a double-close race stays quiet', () => {
      expect(service.closeRoom('missing')).toBe(true);
    });
  });

  describe('closeStaleRooms', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('force-closes a room past the threshold even though peers still remain, releasing the router and worker slot', async () => {
      const worker = stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      jest.setSystemTime(1000 + 60_000);
      const closedRoomIds = service.closeStaleRooms(30_000);

      expect(closedRoomIds).toEqual(['room-1']);
      expect(router.close).toHaveBeenCalledTimes(1);
      expect(workerPool.trackRouterClosed).toHaveBeenCalledWith(worker);
      expect(() => service.getRoom('room-1')).toThrow(NotFoundException);
    });

    it('leaves a room under normal-but-quiet use alone, since occasional produce/consume keeps refreshing it', async () => {
      stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      const room = await service.getOrCreateRoom('room-1');
      room.getOrCreatePeer('peer-1');

      // A produce/consume-style call in the middle of the quiet period
      // refreshes the room via getRoom, same as any real REST call would.
      jest.setSystemTime(1000 + 20_000);
      service.getRoom('room-1');

      jest.setSystemTime(1000 + 45_000);
      const closedRoomIds = service.closeStaleRooms(30_000);

      expect(closedRoomIds).toEqual([]);
      expect(router.close).not.toHaveBeenCalled();
      expect(service.getRoom('room-1')).toBe(room);
    });

    it('does not touch rooms still under the threshold', async () => {
      stubWorkerCreatingRouter();
      jest.useFakeTimers().setSystemTime(1000);
      await service.getOrCreateRoom('room-1');

      jest.setSystemTime(1000 + 10_000);
      const closedRoomIds = service.closeStaleRooms(30_000);

      expect(closedRoomIds).toEqual([]);
      expect(router.close).not.toHaveBeenCalled();
    });

    it('closes only the rooms that are actually stale, one room going quiet does not affect another', async () => {
      const workerA = createFakeWorker();
      const routerA = { ...router, close: jest.fn() };
      workerA.createRouter.mockResolvedValue(routerA);
      const workerB = createFakeWorker();
      const routerB = { ...router, close: jest.fn() };
      workerB.createRouter.mockResolvedValue(routerB);

      jest.useFakeTimers().setSystemTime(1000);
      workerPool.reserveWorker.mockReturnValueOnce(workerA);
      await service.getOrCreateRoom('stale-room');
      workerPool.reserveWorker.mockReturnValueOnce(workerB);
      await service.getOrCreateRoom('fresh-room');

      jest.setSystemTime(1000 + 40_000);
      service.getRoom('fresh-room');

      const closedRoomIds = service.closeStaleRooms(30_000);

      expect(closedRoomIds).toEqual(['stale-room']);
      expect(routerA.close).toHaveBeenCalledTimes(1);
      expect(routerB.close).not.toHaveBeenCalled();
      expect(service.getRoom('fresh-room')).toBeDefined();
    });
  });

  describe('getTotalConsumerCount', () => {
    it('returns 0 when no rooms exist', () => {
      expect(service.getTotalConsumerCount()).toBe(0);
    });

    it('sums consumers across every peer in every room, not just one', async () => {
      stubWorkerCreatingRouter();
      const room1 = await service.getOrCreateRoom('room-1');
      const room2 = await service.getOrCreateRoom('room-2');
      const peer1 = room1.getOrCreatePeer('peer-1');
      const peer2 = room1.getOrCreatePeer('peer-2');
      const peer3 = room2.getOrCreatePeer('peer-3');
      peer1.consumers.set('c1', {} as any);
      peer1.consumers.set('c2', {} as any);
      peer2.consumers.set('c3', {} as any);
      peer3.consumers.set('c4', {} as any);

      expect(service.getTotalConsumerCount()).toBe(4);
    });
  });
});
