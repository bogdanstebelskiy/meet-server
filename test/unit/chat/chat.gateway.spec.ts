import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChatGateway } from '../../../src/chat/chat.gateway';
import { ChatService } from '../../../src/chat/chat.service';
import { RoomsService } from '../../../src/rooms/rooms.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: Record<string, jest.Mock>;
  let roomsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    chatService = {
      addMessage: jest.fn(),
      getHistory: jest.fn(),
    };

    roomsService = {
      getPeer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: chatService },
        { provide: RoomsService, useValue: roomsService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    (gateway as any).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
  });

  describe('sendChatMessage', () => {
    it('stores the message with the peer displayName and broadcasts it to the room', async () => {
      roomsService.getPeer.mockReturnValue({
        id: 'socket-1',
        displayName: 'Alice',
      });
      const stored = {
        id: '1-0',
        peerId: 'socket-1',
        displayName: 'Alice',
        body: 'hi',
        ts: 123,
      };
      chatService.addMessage.mockResolvedValue(stored);

      const result = await gateway.sendChatMessage(
        { roomId: 'room-1', peerId: 'socket-1' },
        { body: 'hi' },
      );

      expect(roomsService.getPeer).toHaveBeenCalledWith('room-1', 'socket-1');
      expect(chatService.addMessage).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          peerId: 'socket-1',
          displayName: 'Alice',
          body: 'hi',
        }),
      );
      expect((gateway as any).server.to).toHaveBeenCalledWith('room-1');
      expect(result).toEqual({ ok: true });
    });

    it('throws when the peer is not found in the room', async () => {
      roomsService.getPeer.mockReturnValue(undefined);

      await expect(
        gateway.sendChatMessage(
          { roomId: 'room-1', peerId: 'socket-1' },
          { body: 'hi' },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(chatService.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('getChatHistory', () => {
    it('returns the stored history for the room', async () => {
      const messages = [
        {
          id: '1-0',
          peerId: 'socket-1',
          displayName: 'Alice',
          body: 'hi',
          ts: 1,
        },
      ];
      chatService.getHistory.mockResolvedValue(messages);

      const result = await gateway.getChatHistory({
        roomId: 'room-1',
        peerId: 'socket-1',
      });

      expect(chatService.getHistory).toHaveBeenCalledWith('room-1');
      expect(result).toEqual({ messages });
    });
  });
});
