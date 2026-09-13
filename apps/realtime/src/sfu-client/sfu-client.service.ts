import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, type Observable } from 'rxjs';
import { isAxiosError, type AxiosResponse } from 'axios';
import { buildMediaRoomPath, MEDIA_ROOM_ROUTES } from '@app/media-contracts';
import type {
  CloseRoomResponse,
  ConnectTransportResponse,
  ConsumeResponse,
  CreateTransportResponse,
  MediaRoomResponse,
  MediaRoomsStatsResponse,
  PauseProducerResponse,
  ProduceResponse,
  RemovePeerResponse,
  ResumeConsumerResponse,
  ResumeProducerResponse,
  TransportDirection,
} from '@app/media-contracts';
import type { DtlsParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/types';
import type { HttpExceptionBody } from './types';

@Injectable()
export class SfuClientService {
  constructor(private readonly httpService: HttpService) {}

  getStats(nodeUrl: string): Promise<MediaRoomsStatsResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.stats, {});

    return this.request(() => this.httpService.get<MediaRoomsStatsResponse>(url));
  }

  createOrGetMediaRoom(nodeUrl: string, roomId: string): Promise<MediaRoomResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.createOrGetRoom, {
      roomId,
    });

    return this.request(() => this.httpService.put<MediaRoomResponse>(url));
  }

  createTransport(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ): Promise<CreateTransportResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.createTransport, {
      roomId,
      peerId,
    });

    return this.request(() => this.httpService.post<CreateTransportResponse>(url, { direction }));
  }

  connectTransport(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<ConnectTransportResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.connectTransport, {
      roomId,
      peerId,
      transportId,
    });

    return this.request(() =>
      this.httpService.post<ConnectTransportResponse>(url, {
        dtlsParameters,
      }),
    );
  }

  produce(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<ProduceResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.produce, {
      roomId,
      peerId,
      transportId,
    });

    return this.request(() => this.httpService.post<ProduceResponse>(url, { kind, rtpParameters }));
  }

  consume(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumeResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.consume, {
      roomId,
      peerId,
    });

    return this.request(() =>
      this.httpService.post<ConsumeResponse>(url, {
        producerId,
        rtpCapabilities,
      }),
    );
  }

  resumeConsumer(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.resumeConsumer, {
      roomId,
      peerId,
      consumerId,
    });

    return this.request(() => this.httpService.post<ResumeConsumerResponse>(url));
  }

  pauseProducer(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<PauseProducerResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.pauseProducer, {
      roomId,
      peerId,
      producerId,
    });

    return this.request(() => this.httpService.post<PauseProducerResponse>(url));
  }

  resumeProducer(
    nodeUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<ResumeProducerResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.resumeProducer, {
      roomId,
      peerId,
      producerId,
    });

    return this.request(() => this.httpService.post<ResumeProducerResponse>(url));
  }

  removePeer(nodeUrl: string, roomId: string, peerId: string): Promise<RemovePeerResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.removePeer, {
      roomId,
      peerId,
    });

    return this.request(() => this.httpService.delete<RemovePeerResponse>(url));
  }

  closeRoom(nodeUrl: string, roomId: string): Promise<CloseRoomResponse> {
    const url = this.buildUrl(nodeUrl, MEDIA_ROOM_ROUTES.closeRoom, { roomId });

    return this.request(() => this.httpService.delete<CloseRoomResponse>(url));
  }

  // Every call targets a specific sfu instance's URL rather than a shared
  // fixed baseURL - see sfu-client.module.ts.
  private buildUrl(nodeUrl: string, pattern: string, params: Record<string, string>): string {
    const path = buildMediaRoomPath(pattern, params);
    return `${nodeUrl}${path}`;
  }

  // Reconstructs a real HttpException from apps/sfu's default Nest error
  // body, so WsExceptionFilter surfaces the same message/status it would if
  // this were still an in-process NotFoundException. A connection-level
  // failure (apps/sfu unreachable, timed out) has no response body to read,
  // so it's reported as 503 rather than left to escape as a raw AxiosError,
  // which WsExceptionFilter would otherwise mask as an opaque 500.
  private async request<T>(call: () => Observable<AxiosResponse<T>>): Promise<T> {
    try {
      const observable = call();
      const response = await firstValueFrom(observable);

      return response.data;
    } catch (error) {
      if (!isAxiosError(error)) {
        throw error;
      }

      if (!error.response) {
        throw new HttpException(
          `apps/sfu is unreachable: ${error.message}`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const body = error.response.data as HttpExceptionBody;

      throw new HttpException(
        body.message ?? error.message,
        body.statusCode ?? error.response.status,
      );
    }
  }
}
