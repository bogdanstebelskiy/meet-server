import { NotFoundException } from '@nestjs/common';
import { SignalingService } from '../../../src/signaling/signaling.service';
import { RoomsService } from '../../../src/rooms/rooms.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';
import { ChatService } from '../../../src/chat/chat.service';

describe('SignalingService', () => {
  let service: SignalingService;
  let roomsService: {
    getOrCreateRoom: jest.Mock;
    getRoom: jest.Mock;
    getPeer: jest.Mock;
    getOtherPeers: jest.Mock;
    addPeer: jest.Mock;
    removePeer: jest.Mock;
    isEmpty: jest.Mock;
    closeRoom: jest.Mock;
    addProducer: jest.Mock;
    getProducers: jest.Mock;
  };
  let sfuClient: {
    createTransport: jest.Mock;
    connectTransport: jest.Mock;
    produce: jest.Mock;
    consume: jest.Mock;
    resumeConsumer: jest.Mock;
    pauseProducer: jest.Mock;
    resumeProducer: jest.Mock;
    removePeer: jest.Mock;
    closeRoom: jest.Mock;
  };
  let chatService: {
    deleteRoomHistory: jest.Mock;
  };
  const room = { id: 'room-1', rtpCapabilities: { codecs: [] } };

  beforeEach(() => {
    roomsService = {
      getOrCreateRoom: jest.fn().mockResolvedValue(room),
      getRoom: jest.fn().mockResolvedValue(room),
      getPeer: jest.fn().mockResolvedValue(undefined),
      getOtherPeers: jest.fn().mockResolvedValue([]),
      addPeer: jest.fn().mockResolvedValue(undefined),
      removePeer: jest.fn().mockResolvedValue(undefined),
      isEmpty: jest.fn().mockResolvedValue(false),
      closeRoom: jest.fn().mockResolvedValue(true),
      addProducer: jest.fn().mockResolvedValue(undefined),
      getProducers: jest.fn().mockResolvedValue([]),
    };

    sfuClient = {
      createTransport: jest.fn(),
      connectTransport: jest.fn(),
      produce: jest.fn(),
      consume: jest.fn(),
      resumeConsumer: jest.fn(),
      pauseProducer: jest.fn(),
      resumeProducer: jest.fn(),
      removePeer: jest.fn().mockResolvedValue({ removed: true }),
      closeRoom: jest.fn().mockResolvedValue({ closed: true }),
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
      roomsService.getOtherPeers.mockResolvedValue([
        { id: 'peer-existing', displayName: 'Bob' },
      ]);

      const { peer, existingPeers } = await service.join(
        'room-1',
        'peer-1',
        'Alice',
      );

      expect(roomsService.addPeer).toHaveBeenCalledWith('room-1', {
        id: 'peer-1',
        displayName: 'Alice',
      });
      expect(peer).toEqual({ id: 'peer-1', displayName: 'Alice' });
      expect(existingPeers).toEqual([
        { id: 'peer-existing', displayName: 'Bob' },
      ]);
    });

    it('does not include the joining peer itself in existingPeers', async () => {
      const { existingPeers } = await service.join('room-1', 'peer-1', 'Alice');

      expect(roomsService.getOtherPeers).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
      );
      expect(existingPeers).toEqual([]);
    });

    it('removes the peer it just added if reading other peers fails', async () => {
      const readError = new Error('redis blip');
      roomsService.getOtherPeers.mockRejectedValue(readError);

      await expect(service.join('room-1', 'peer-1', 'Alice')).rejects.toThrow(
        readError,
      );

      expect(roomsService.addPeer).toHaveBeenCalledWith('room-1', {
        id: 'peer-1',
        displayName: 'Alice',
      });
      expect(roomsService.removePeer).toHaveBeenCalledWith('room-1', 'peer-1');
    });

    it('collects existing producers from other peers', async () => {
      roomsService.getOtherPeers.mockResolvedValue([
        { id: 'peer-bob', displayName: 'Bob' },
        { id: 'peer-carol', displayName: 'Carol' },
      ]);
      roomsService.getProducers.mockImplementation(
        async (_roomId: string, peerId: string) => {
          if (peerId === 'peer-bob') {
            return [
              { producerId: 'prod-audio', kind: 'audio' },
              { producerId: 'prod-video', kind: 'video' },
            ];
          }
          return [{ producerId: 'prod-carol', kind: 'audio' }];
        },
      );

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
      roomsService.getOtherPeers.mockResolvedValue([
        { id: 'peer-bob', displayName: 'Bob' },
      ]);

      const { existingProducers } = await service.join(
        'room-1',
        'peer-1',
        'Alice',
      );

      expect(existingProducers).toEqual([]);
    });
  });

  describe('getRoom / getPeer', () => {
    it('throws NotFoundException for an unknown room', async () => {
      roomsService.getRoom.mockResolvedValue(undefined);

      await expect(service.getRoom('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for an unknown peer in a known room', async () => {
      await expect(service.getPeer('room-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createWebRtcTransport', () => {
    it('delegates to the SfuClient once the room and peer are known', async () => {
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });
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
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });

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
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });
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
      expect(roomsService.addProducer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
        'audio',
      );
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
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });
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
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });

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
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });

      await service.pauseProducer('room-1', 'peer-1', 'prod-1');

      expect(sfuClient.pauseProducer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
      );
    });

    it('resumeProducer delegates to the SfuClient', async () => {
      roomsService.getPeer.mockResolvedValue({
        id: 'peer-1',
        displayName: 'Alice',
      });

      await service.resumeProducer('room-1', 'peer-1', 'prod-1');

      expect(sfuClient.resumeProducer).toHaveBeenCalledWith(
        'room-1',
        'peer-1',
        'prod-1',
      );
    });
  });

  describe('leave', () => {
    it('is a no-op when the room does not exist', async () => {
      roomsService.getRoom.mockResolvedValue(undefined);

      await expect(service.leave('missing', 'peer-1')).resolves.not.toThrow();
      expect(roomsService.removePeer).not.toHaveBeenCalled();
      expect(roomsService.closeRoom).not.toHaveBeenCalled();
      expect(sfuClient.removePeer).not.toHaveBeenCalled();
      expect(sfuClient.closeRoom).not.toHaveBeenCalled();
    });

    it('removes the peer in apps/sfu but does not close the room while others remain', async () => {
      roomsService.isEmpty.mockResolvedValue(false);

      await service.leave('room-1', 'peer-1');

      expect(roomsService.removePeer).toHaveBeenCalledWith('room-1', 'peer-1');
      expect(sfuClient.removePeer).toHaveBeenCalledWith('room-1', 'peer-1');
      expect(roomsService.closeRoom).not.toHaveBeenCalled();
      expect(sfuClient.closeRoom).not.toHaveBeenCalled();
      expect(chatService.deleteRoomHistory).not.toHaveBeenCalled();
    });

    it('closes the room in apps/sfu and deletes its chat history once the last peer leaves', async () => {
      roomsService.isEmpty.mockResolvedValue(true);
      roomsService.closeRoom.mockResolvedValue(true);

      await service.leave('room-1', 'peer-1');

      expect(roomsService.closeRoom).toHaveBeenCalledWith('room-1');
      expect(sfuClient.closeRoom).toHaveBeenCalledWith('room-1');
      expect(chatService.deleteRoomHistory).toHaveBeenCalledWith('room-1');
    });

    it('does not close the room in apps/sfu or delete chat history when a peer joins between the emptiness check and the redis close (issue #24)', async () => {
      roomsService.isEmpty.mockResolvedValue(true);
      roomsService.closeRoom.mockResolvedValue(false);

      await service.leave('room-1', 'peer-1');

      expect(roomsService.closeRoom).toHaveBeenCalledWith('room-1');
      expect(sfuClient.closeRoom).not.toHaveBeenCalled();
      expect(chatService.deleteRoomHistory).not.toHaveBeenCalled();
    });

    it('waits for the sfu peer removal to land before closing the room there, so a still-in-flight removal never loses the closeRoom race', async () => {
      roomsService.isEmpty.mockResolvedValue(true);
      const callOrder: string[] = [];
      let resolveRemovePeer!: () => void;
      const removePeerPromise = new Promise((resolve) => {
        resolveRemovePeer = () => {
          callOrder.push('removePeer');
          resolve({ removed: true });
        };
      });
      sfuClient.removePeer.mockReturnValue(removePeerPromise);
      sfuClient.closeRoom.mockImplementation(() => {
        callOrder.push('closeRoom');
        return Promise.resolve({ closed: true });
      });

      const leaving = service.leave('room-1', 'peer-1');
      resolveRemovePeer();
      await leaving;

      expect(callOrder).toEqual(['removePeer', 'closeRoom']);
    });

    it('resolves even when apps/sfu teardown rejects, so a disconnect never hangs or throws', async () => {
      roomsService.isEmpty.mockResolvedValue(true);
      sfuClient.removePeer.mockRejectedValue(new Error('sfu unreachable'));
      sfuClient.closeRoom.mockRejectedValue(new Error('sfu unreachable'));

      await expect(service.leave('room-1', 'peer-1')).resolves.toBeUndefined();

      // Flush the fire-and-forget .catch() handlers before the test ends.
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
