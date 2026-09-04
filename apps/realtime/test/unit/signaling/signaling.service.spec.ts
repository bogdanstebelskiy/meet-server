import { NotFoundException } from '@nestjs/common';
import { SignalingService } from '../../../src/signaling/signaling.service';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';
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
  let sfuClient: {
    createTransport: jest.Mock;
    connectTransport: jest.Mock;
    produce: jest.Mock;
    consume: jest.Mock;
    resumeConsumer: jest.Mock;
    pauseProducer: jest.Mock;
    resumeProducer: jest.Mock;
  };
  let chatService: {
    deleteRoomHistory: jest.Mock;
  };
  let room: Room;

  beforeEach(() => {
    room = new Room('room-1', { codecs: [] });

    roomsService = {
      getOrCreateRoom: jest.fn().mockResolvedValue(room),
      getRoom: jest.fn().mockReturnValue(room),
      getPeer: jest.fn((_roomId: string, peerId: string) =>
        room.peers.get(peerId),
      ),
      closeRoom: jest.fn(),
    };

    sfuClient = {
      createTransport: jest.fn(),
      connectTransport: jest.fn(),
      produce: jest.fn(),
      consume: jest.fn(),
      resumeConsumer: jest.fn(),
      pauseProducer: jest.fn(),
      resumeProducer: jest.fn(),
    };

    chatService = {
      deleteRoomHistory: jest.fn().mockResolvedValue(undefined),
    };

    service = new SignalingService(
      roomsService as unknown as RoomsService,
      sfuClient as unknown as SfuClientService,
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
      bob.producers.set('prod-audio', 'audio');
      bob.producers.set('prod-video', 'video');
      const carol = new Peer('peer-carol', 'Carol');
      carol.producers.set('prod-carol', 'audio');
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
    it('delegates to the SfuClient once the room and peer are known locally', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);
      const transport = { id: 't1' };
      sfuClient.createTransport.mockResolvedValue(transport);

      const result = await service.createWebRtcTransport(
        'room-1',
        'peer-1',
        'send',
      );

      expect(result).toBe(transport);
      expect(sfuClient.createTransport).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'send',
      );
    });

    it('throws NotFoundException for an unknown peer without calling the SfuClient', async () => {
      await expect(
        service.createWebRtcTransport('room-1', 'missing', 'send'),
      ).rejects.toThrow(NotFoundException);
      expect(sfuClient.createTransport).not.toHaveBeenCalled();
    });
  });

  describe('connectWebRtcTransport', () => {
    it('delegates to the SfuClient with the transport id and dtlsParameters', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await service.connectWebRtcTransport('room-1', 'peer-1', 't1', {
        role: 'client',
      } as any);

      expect(sfuClient.connectTransport).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        't1',
        { role: 'client' },
      );
    });

    it('throws NotFoundException for an unknown peer without calling the SfuClient', async () => {
      await expect(
        service.connectWebRtcTransport('room-1', 'missing', 't1', {} as any),
      ).rejects.toThrow(NotFoundException);
      expect(sfuClient.connectTransport).not.toHaveBeenCalled();
    });
  });

  describe('produce', () => {
    it('delegates to the SfuClient and records the producer kind for backfill', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);
      sfuClient.produce.mockResolvedValue({ id: 'prod-1' });

      const result = await service.produce(
        'room-1',
        'peer-1',
        't1',
        'audio',
        {} as any,
      );

      expect(result).toEqual({ id: 'prod-1' });
      expect(sfuClient.produce).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        't1',
        'audio',
        {},
      );
      expect(peer.producers.get('prod-1')).toBe('audio');
    });

    it('throws NotFoundException for an unknown peer without calling the SfuClient', async () => {
      await expect(
        service.produce('room-1', 'missing', 't1', 'audio', {} as any),
      ).rejects.toThrow(NotFoundException);
      expect(sfuClient.produce).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    it('delegates to the SfuClient and returns its response as-is', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);
      const consumeResponse = {
        id: 'cons-1',
        producerId: 'prod-1',
        kind: 'audio',
        rtpParameters: {},
        producerPaused: false,
      };
      sfuClient.consume.mockResolvedValue(consumeResponse);

      const result = await service.consume('room-1', 'peer-1', 'prod-1', {});

      expect(result).toBe(consumeResponse);
      expect(sfuClient.consume).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
        {},
      );
    });

    it('throws NotFoundException for an unknown peer without calling the SfuClient', async () => {
      await expect(
        service.consume('room-1', 'missing', 'prod-1', {} as any),
      ).rejects.toThrow(NotFoundException);
      expect(sfuClient.consume).not.toHaveBeenCalled();
    });
  });

  describe('resumeConsumer', () => {
    it('delegates to the SfuClient', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await service.resumeConsumer('room-1', 'peer-1', 'cons-1');

      expect(sfuClient.resumeConsumer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'cons-1',
      );
    });

    it('throws NotFoundException for an unknown peer without calling the SfuClient', async () => {
      await expect(
        service.resumeConsumer('room-1', 'missing', 'cons-1'),
      ).rejects.toThrow(NotFoundException);
      expect(sfuClient.resumeConsumer).not.toHaveBeenCalled();
    });
  });

  describe('pauseProducer / resumeProducer', () => {
    it('pauseProducer delegates to the SfuClient', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await service.pauseProducer('room-1', 'peer-1', 'prod-1');

      expect(sfuClient.pauseProducer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
      );
    });

    it('resumeProducer delegates to the SfuClient', async () => {
      const peer = new Peer('peer-1', 'Alice');
      room.addPeer(peer);

      await service.resumeProducer('room-1', 'peer-1', 'prod-1');

      expect(sfuClient.resumeProducer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
      );
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
