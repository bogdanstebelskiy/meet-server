import { HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';

describe('SfuClientService', () => {
  let service: SfuClientService;
  let httpService: {
    get: jest.Mock;
    put: jest.Mock;
    post: jest.Mock;
    delete: jest.Mock;
  };
  const nodeUrl = 'http://sfu-1:3001';

  beforeEach(() => {
    httpService = {
      get: jest.fn(),
      put: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };

    service = new SfuClientService(httpService as unknown as HttpService);
  });

  function axiosErrorWithResponse(status: number, body: unknown) {
    return new AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      { status, data: body } as any,
    );
  }

  describe('getStats', () => {
    it('GETs the node stats route and returns the response body', async () => {
      const stats = { roomCount: 3 };
      httpService.get.mockReturnValue(of({ data: stats }));

      const result = await service.getStats(nodeUrl);

      expect(httpService.get).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/stats',
      );
      expect(result).toBe(stats);
    });
  });

  describe('createOrGetMediaRoom', () => {
    it('PUTs the roomId against the given node and returns the response body', async () => {
      const mediaRoom = { roomId: 'room-1', rtpCapabilities: { codecs: [] } };
      httpService.put.mockReturnValue(of({ data: mediaRoom }));

      const result = await service.createOrGetMediaRoom(nodeUrl, 'room-1');

      expect(httpService.put).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1',
      );
      expect(result).toBe(mediaRoom);
    });
  });

  describe('createTransport', () => {
    it('POSTs the direction and returns the response body', async () => {
      const transport = { id: 't1' };
      httpService.post.mockReturnValue(of({ data: transport }));

      const result = await service.createTransport(
        nodeUrl,
        'room-1',
        'peer-1',
        'send',
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/transports',
        { direction: 'send' },
      );
      expect(result).toBe(transport);
    });
  });

  describe('connectTransport', () => {
    it('POSTs the dtlsParameters to the transport connect route', async () => {
      const response = { connected: true };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.connectTransport(
        nodeUrl,
        'room-1',
        'peer-1',
        't1',
        { role: 'client' } as any,
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/transports/t1/connect',
        { dtlsParameters: { role: 'client' } },
      );
      expect(result).toBe(response);
    });
  });

  describe('produce', () => {
    it('POSTs the kind and rtpParameters to the transport produce route', async () => {
      const response = { id: 'prod-1' };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.produce(
        nodeUrl,
        'room-1',
        'peer-1',
        't1',
        'audio',
        { codecs: [] },
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/transports/t1/produce',
        { kind: 'audio', rtpParameters: { codecs: [] } },
      );
      expect(result).toBe(response);
    });
  });

  describe('consume', () => {
    it('POSTs the producerId and rtpCapabilities to the peer consumers route', async () => {
      const response = {
        id: 'cons-1',
        producerId: 'prod-1',
        kind: 'audio',
        rtpParameters: {},
        producerPaused: false,
      };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.consume(
        nodeUrl,
        'room-1',
        'peer-1',
        'prod-1',
        {
          codecs: [],
        },
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/consumers',
        { producerId: 'prod-1', rtpCapabilities: { codecs: [] } },
      );
      expect(result).toBe(response);
    });
  });

  describe('resumeConsumer', () => {
    it('POSTs to the consumer resume route', async () => {
      const response = { resumed: true };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.resumeConsumer(
        nodeUrl,
        'room-1',
        'peer-1',
        'cons-1',
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/consumers/cons-1/resume',
      );
      expect(result).toBe(response);
    });
  });

  describe('pauseProducer', () => {
    it('POSTs to the producer pause route', async () => {
      const response = { paused: true };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.pauseProducer(
        nodeUrl,
        'room-1',
        'peer-1',
        'prod-1',
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/producers/prod-1/pause',
      );
      expect(result).toBe(response);
    });
  });

  describe('resumeProducer', () => {
    it('POSTs to the producer resume route', async () => {
      const response = { resumed: true };
      httpService.post.mockReturnValue(of({ data: response }));

      const result = await service.resumeProducer(
        nodeUrl,
        'room-1',
        'peer-1',
        'prod-1',
      );

      expect(httpService.post).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1/producers/prod-1/resume',
      );
      expect(result).toBe(response);
    });
  });

  describe('removePeer', () => {
    it('DELETEs the peer route and returns the response body', async () => {
      const response = { removed: true };
      httpService.delete.mockReturnValue(of({ data: response }));

      const result = await service.removePeer(nodeUrl, 'room-1', 'peer-1');

      expect(httpService.delete).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1/peers/peer-1',
      );
      expect(result).toBe(response);
    });
  });

  describe('closeRoom', () => {
    it('DELETEs the room route and returns the response body', async () => {
      const response = { closed: true };
      httpService.delete.mockReturnValue(of({ data: response }));

      const result = await service.closeRoom(nodeUrl, 'room-1');

      expect(httpService.delete).toHaveBeenCalledWith(
        'http://sfu-1:3001/media-rooms/room-1',
      );
      expect(result).toBe(response);
    });
  });

  describe('error reconstruction', () => {
    it('reconstructs an HttpException from apps/sfu default error body', async () => {
      httpService.put.mockReturnValue(
        throwError(() =>
          axiosErrorWithResponse(404, {
            statusCode: 404,
            message: 'MediaRoom room-1 not found',
            error: 'Not Found',
          }),
        ),
      );

      await expect(
        service.createOrGetMediaRoom(nodeUrl, 'room-1'),
      ).rejects.toThrow(HttpException);

      try {
        await service.createOrGetMediaRoom(nodeUrl, 'room-1');
        fail('expected createOrGetMediaRoom to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(404);
        expect((error as HttpException).message).toBe(
          'MediaRoom room-1 not found',
        );
      }
    });

    it('falls back to the axios status/message when the body has no message', async () => {
      httpService.put.mockReturnValue(
        throwError(() => axiosErrorWithResponse(500, {})),
      );

      try {
        await service.createOrGetMediaRoom(nodeUrl, 'room-1');
        fail('expected createOrGetMediaRoom to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(500);
      }
    });

    it('reports apps/sfu being unreachable as a 503, not a raw AxiosError', async () => {
      const connectionError = new AxiosError(
        'connect ECONNREFUSED 127.0.0.1:3001',
        'ECONNREFUSED',
      );
      httpService.put.mockReturnValue(throwError(() => connectionError));

      try {
        await service.createOrGetMediaRoom(nodeUrl, 'room-1');
        fail('expected createOrGetMediaRoom to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(503);
        expect((error as HttpException).message).toContain('unreachable');
      }
    });

    it('rethrows non-axios errors unchanged', async () => {
      const unexpectedError = new Error('something else entirely');
      httpService.put.mockReturnValue(throwError(() => unexpectedError));

      await expect(
        service.createOrGetMediaRoom(nodeUrl, 'room-1'),
      ).rejects.toBe(unexpectedError);
    });
  });
});
