import { Test, TestingModule } from '@nestjs/testing';
import { SignalingGateway } from '../../../src/signaling/signaling.gateway';
import { SignalingService } from '../../../src/signaling/signaling.service';

describe('SignalingGateway', () => {
  let gateway: SignalingGateway;
  let signalingService: Record<string, jest.Mock>;

  const createFakeClient = (data: Record<string, unknown> = {}) => {
    const emit = jest.fn();
    return {
      id: 'socket-1',
      data,
      join: jest.fn().mockResolvedValue(undefined),
      to: jest.fn().mockReturnValue({ emit }),
      emit: jest.fn(),
      _emit: emit,
    } as any;
  };

  beforeEach(async () => {
    signalingService = {
      join: jest.fn(),
      getRoom: jest.fn(),
      createWebRtcTransport: jest.fn(),
      connectWebRtcTransport: jest.fn(),
      produce: jest.fn(),
      consume: jest.fn(),
      resumeConsumer: jest.fn(),
      leave: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalingGateway,
        { provide: SignalingService, useValue: signalingService },
      ],
    }).compile();

    gateway = module.get<SignalingGateway>(SignalingGateway);
  });

  describe('join', () => {
    it('uses the socket id as peerId, joins the socket.io room, and broadcasts newPeer', async () => {
      const client = createFakeClient();
      const peer = { id: 'socket-1', displayName: 'Alice' };
      signalingService.join.mockResolvedValue({
        peer,
        existingPeers: [],
        existingProducers: [],
      });

      const result = await gateway.join(client, {
        roomId: 'room-1',
        displayName: 'Alice',
      });

      expect(signalingService.join).toHaveBeenCalledWith(
        'room-1',
        'socket-1',
        'Alice',
      );
      expect(client.data.roomId).toBe('room-1');
      expect(client.data.peerId).toBe('socket-1');
      expect(client.join).toHaveBeenCalledWith('room-1');
      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client._emit).toHaveBeenCalledWith('newPeer', {
        id: 'socket-1',
        displayName: 'Alice',
      });
      expect(result).toEqual({ peerId: 'socket-1', existingPeers: [] });
    });

    it('emits newProducer to the joining client for each existing producer', async () => {
      const client = createFakeClient();
      const peer = { id: 'socket-1', displayName: 'Alice' };
      signalingService.join.mockResolvedValue({
        peer,
        existingPeers: [{ id: 'peer-bob', displayName: 'Bob' }],
        existingProducers: [
          { peerId: 'peer-bob', producerId: 'prod-audio', kind: 'audio' },
          { peerId: 'peer-bob', producerId: 'prod-video', kind: 'video' },
        ],
      });

      await gateway.join(client, { roomId: 'room-1', displayName: 'Alice' });

      // Direct emit, not a room broadcast - nobody else needs this.
      expect(client.emit).toHaveBeenCalledTimes(2);
      expect(client.emit).toHaveBeenCalledWith('newProducer', {
        peerId: 'peer-bob',
        producerId: 'prod-audio',
        kind: 'audio',
      });
      expect(client.emit).toHaveBeenCalledWith('newProducer', {
        peerId: 'peer-bob',
        producerId: 'prod-video',
        kind: 'video',
      });
    });

    it('emits nothing when there are no existing producers', async () => {
      const client = createFakeClient();
      const peer = { id: 'socket-1', displayName: 'Alice' };
      signalingService.join.mockResolvedValue({
        peer,
        existingPeers: [],
        existingProducers: [],
      });

      await gateway.join(client, { roomId: 'room-1', displayName: 'Alice' });

      expect(client.emit).not.toHaveBeenCalled();
    });
  });

  // These handlers take context directly, not the socket: calling the method
  // here bypasses Nest's param-decorator pipeline, so we pass it ourselves.
  describe('getRouterRtpCapabilities', () => {
    it('returns the router capabilities for the given roomId', () => {
      const rtpCapabilities = { codecs: [] };
      signalingService.getRoom.mockReturnValue({ router: { rtpCapabilities } });

      const result = gateway.getRouterRtpCapabilities({
        roomId: 'room-1',
        peerId: 'socket-1',
      });

      expect(signalingService.getRoom).toHaveBeenCalledWith('room-1');
      expect(result).toBe(rtpCapabilities);
    });
  });

  describe('createWebRtcTransport', () => {
    it('shapes the transport into only the client-facing connection params', async () => {
      signalingService.createWebRtcTransport.mockResolvedValue({
        id: 't1',
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
        appData: { shouldNotLeakToClient: true },
      });

      const result = await gateway.createWebRtcTransport(
        { roomId: 'room-1', peerId: 'socket-1' },
        { direction: 'send' },
      );

      expect(signalingService.createWebRtcTransport).toHaveBeenCalledWith(
        'room-1',
        'socket-1',
        'send',
      );
      expect(result).toEqual({
        id: 't1',
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
      });
    });
  });

  describe('produce', () => {
    it('broadcasts newProducer to the room and returns only the producer id', async () => {
      const client = createFakeClient({ roomId: 'room-1', peerId: 'socket-1' });
      signalingService.produce.mockResolvedValue({
        id: 'prod-1',
        kind: 'audio',
      });

      const result = await gateway.produce(
        client,
        { roomId: 'room-1', peerId: 'socket-1' },
        {
          transportId: 't1',
          kind: 'audio',
          rtpParameters: {} as any,
        },
      );

      expect(signalingService.produce).toHaveBeenCalledWith(
        'room-1',
        'socket-1',
        't1',
        'audio',
        {},
      );
      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client._emit).toHaveBeenCalledWith('newProducer', {
        peerId: 'socket-1',
        producerId: 'prod-1',
        kind: 'audio',
      });
      expect(result).toEqual({ id: 'prod-1' });
    });
  });

  describe('handleDisconnect', () => {
    it('is a no-op when the socket disconnects without ever having joined a room', () => {
      const client = createFakeClient();

      gateway.handleDisconnect(client);

      expect(signalingService.leave).not.toHaveBeenCalled();
      expect(client.to).not.toHaveBeenCalled();
    });

    it('tells the service to leave and broadcasts peerClosed when the socket had joined', () => {
      const client = createFakeClient({ roomId: 'room-1', peerId: 'socket-1' });

      gateway.handleDisconnect(client);

      expect(signalingService.leave).toHaveBeenCalledWith('room-1', 'socket-1');
      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client._emit).toHaveBeenCalledWith('peerClosed', {
        peerId: 'socket-1',
      });
    });
  });
});
