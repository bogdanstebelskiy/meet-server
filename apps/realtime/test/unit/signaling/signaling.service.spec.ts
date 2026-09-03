import { NotFoundException } from '@nestjs/common';
import { SignalingService } from '../../../src/signaling/signaling.service';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { ChatService } from '../../../src/chat/chat.service';
import { Room } from '../../../src/rooms/entities/room.entity';
import { Peer } from '../../../src/rooms/entities/peer.entity';

describe('SignalingService', () => {
  let service: SignalingService;
  let roomsService: {
    getOrCreateRoom: jest.Mock;
    getRoom: jest.Mock;
    getPeer: jest.Mock;
    closeRoom: jest.Mock;
  };
  let chatService: {
    deleteRoomHistory: jest.Mock;
  };
  let router: {
    rtpCapabilities: unknown;
    createWebRtcTransport: jest.Mock;
    canConsume: jest.Mock;
  };
  let room: Room;

  beforeEach(() => {
    router = {
      rtpCapabilities: { codecs: [] },
      createWebRtcTransport: jest.fn(),
      canConsume: jest.fn().mockReturnValue(true),
    };
    room = new Room('room-1', router as any, {} as any);

    roomsService = {
      getOrCreateRoom: jest.fn().mockResolvedValue(room),
      getRoom: jest.fn().mockReturnValue(room),
      getPeer: jest.fn((_roomId: string, peerId: string) =>
        room.peers.get(peerId),
      ),
      closeRoom: jest.fn(),
    };

    chatService = {
      deleteRoomHistory: jest.fn().mockResolvedValue(undefined),
    };

    service = new SignalingService(
      roomsService as unknown as RoomsService,
      chatService as unknown as ChatService,
    );
  });

  describe('join', () => {
    it('adds a new peer to the room and returns the others already present', async () => {
      const existingPeer = new Peer('peer-existing', 'Bob');
      room.addPeer(existingPeer);

      const { peer, existingPeers } = await service.join(
        'room-1',
        'peer-1',
        'Alice',
      );

      expect(room.peers.get('peer-1')).toBe(peer);
      expect(existingPeers).toEqual([
        { id: 'peer-existing', displayName: 'Bob' },
      ]);
    });

    it('does not include the joining peer itself in existingPeers', async () => {
      const { existingPeers } = await service.join('room-1', 'peer-1', 'Alice');

      expect(existingPeers).toEqual([]);
    });

    it('collects existing producers from other peers', async () => {
      const bob = new Peer('peer-bob', 'Bob');
      bob.producers.set('prod-audio', {
        id: 'prod-audio',
        kind: 'audio',
      } as any);
      bob.producers.set('prod-video', {
        id: 'prod-video',
        kind: 'video',
      } as any);
      const carol = new Peer('peer-carol', 'Carol');
      carol.producers.set('prod-carol', {
        id: 'prod-carol',
        kind: 'audio',
      } as any);
      room.addPeer(bob);
      room.addPeer(carol);

      const { existingProducers } = await service.join(
        'room-1',
        'peer-1',
        'Alice',
      );

      expect(existingProducers).toEqual(
        expect.arrayContaining([
          { peerId: 'peer-bob', producerId: 'prod-audio', kind: 'audio' },
          { peerId: 'peer-bob', producerId: 'prod-video', kind: 'video' },
          { peerId: 'peer-carol', producerId: 'prod-carol', kind: 'audio' },
        ]),
      );
      expect(existingProducers).toHaveLength(3);
    });

    it('returns empty existingProducers when nobody is producing', async () => {
      const bob = new Peer('peer-bob', 'Bob');
      room.addPeer(bob);

      const { existingProducers } = await service.join(
        'room-1',
        'peer-1',
        'Alice',
      );

      expect(existingProducers).toEqual([]);
    });
  });

  describe('getRoom / getPeer', () => {
    it('throws NotFoundException for an unknown room', () => {
      roomsService.getRoom.mockReturnValue(undefined);

      expect(() => service.getRoom('missing')).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown peer in a known room', () => {
      expect(() => service.getPeer('room-1', 'missing')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('createWebRtcTransport', () => {
    it('assigns the transport to sendTransport for direction "send"', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);
      const transport = { id: 't1' };
      router.createWebRtcTransport.mockResolvedValue(transport);

      const result = await service.createWebRtcTransport(
        'room-1',
        'peer-1',
        'send',
      );

      expect(result).toBe(transport);
      expect(peer.sendTransport).toBe(transport);
      expect(peer.recvTransport).toBeUndefined();
    });

    it('assigns the transport to recvTransport for direction "recv"', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);
      const transport = { id: 't2' };
      router.createWebRtcTransport.mockResolvedValue(transport);

      await service.createWebRtcTransport('room-1', 'peer-1', 'recv');

      expect(peer.recvTransport).toBe(transport);
      expect(peer.sendTransport).toBeUndefined();
    });
  });

  describe('connectWebRtcTransport', () => {
    it('connects the matching transport by id', async () => {
      const peer = new Peer('peer-1', 'Alice');
      const transport = { id: 't1', connect: jest.fn() };
      peer.sendTransport = transport as any;
      room.addPeer(peer);

      await service.connectWebRtcTransport('room-1', 'peer-1', 't1', {
        role: 'client',
      } as any);

      expect(transport.connect).toHaveBeenCalledWith({
        dtlsParameters: { role: 'client' },
      });
    });

    it('throws NotFoundException when transportId matches neither send nor recv transport', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await expect(
        service.connectWebRtcTransport(
          'room-1',
          'peer-1',
          'unknown',
          {} as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('produce', () => {
    it('produces on the peer send transport and stores the producer', async () => {
      const peer = new Peer('peer-1', 'Alice');
      const producer = { id: 'prod-1' };
      const transport = {
        id: 't1',
        produce: jest.fn().mockResolvedValue(producer),
      };
      peer.sendTransport = transport as any;
      room.addPeer(peer);

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

    it('throws NotFoundException when transportId does not match the peer send transport', async () => {
      const peer = new Peer('peer-1', 'Alice');
      peer.sendTransport = { id: 'other' } as any;
      room.addPeer(peer);

      await expect(
        service.produce('room-1', 'peer-1', 'wrong-id', 'audio', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the peer never created a send transport', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await expect(
        service.produce('room-1', 'peer-1', 't1', 'audio', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('consume', () => {
    it('consumes paused on the peer recv transport and stores the consumer', async () => {
      const peer = new Peer('peer-1', 'Alice');
      const consumer = { id: 'cons-1' };
      const transport = {
        id: 't2',
        consume: jest.fn().mockResolvedValue(consumer),
      };
      peer.recvTransport = transport as any;
      room.addPeer(peer);

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
      router.canConsume.mockReturnValue(false);
      const peer = new Peer('peer-1', 'Alice');
      peer.recvTransport = { consume: jest.fn() } as any;
      room.addPeer(peer);

      await expect(
        service.consume('room-1', 'peer-1', 'prod-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the peer has no recv transport yet', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await expect(
        service.consume('room-1', 'peer-1', 'prod-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resumeConsumer', () => {
    it('resumes a known consumer', async () => {
      const peer = new Peer('peer-1', 'Alice');
      const consumer = { resume: jest.fn() };
      peer.consumers.set('cons-1', consumer as any);
      room.addPeer(peer);

      await service.resumeConsumer('room-1', 'peer-1', 'cons-1');

      expect(consumer.resume).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for an unknown consumer', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await expect(
        service.resumeConsumer('room-1', 'peer-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('leave', () => {
    it('is a no-op when the room does not exist', () => {
      roomsService.getRoom.mockReturnValue(undefined);

      expect(() => service.leave('missing', 'peer-1')).not.toThrow();
      expect(roomsService.closeRoom).not.toHaveBeenCalled();
    });

    it('removes the peer but does not close the room while others remain', () => {
      const peer1 = new Peer('peer-1', 'Alice');
      const peer2 = new Peer('peer-2', 'Bob');
      room.addPeer(peer1);
      room.addPeer(peer2);

      service.leave('room-1', 'peer-1');

      expect(room.peers.has('peer-1')).toBe(false);
      expect(room.peers.has('peer-2')).toBe(true);
      expect(roomsService.closeRoom).not.toHaveBeenCalled();
      expect(chatService.deleteRoomHistory).not.toHaveBeenCalled();
    });

    it('closes the room and deletes its chat history once the last peer leaves', () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      service.leave('room-1', 'peer-1');

      expect(roomsService.closeRoom).toHaveBeenCalledWith('room-1');
      expect(chatService.deleteRoomHistory).toHaveBeenCalledWith('room-1');
    });
  });
});
