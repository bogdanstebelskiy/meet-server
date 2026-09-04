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
  PauseProducerResponse,
  ProduceResponse,
  RemovePeerResponse,
  ResumeConsumerResponse,
  ResumeProducerResponse,
  TransportDirection,
} from '@app/media-contracts';
import type {
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup/types';

interface HttpExceptionBody {
  statusCode?: number;
  message?: string;
}

@Injectable()
export class SfuClientService {
  constructor(private readonly httpService: HttpService) {}

  createOrGetMediaRoom(roomId: string): Promise<MediaRoomResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.createOrGetRoom, {
      roomId,
    });

    return this.request(() => this.httpService.put<MediaRoomResponse>(path));
  }

  createTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ): Promise<CreateTransportResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.createTransport, {
      roomId,
      peerId,
    });

    return this.request(() =>
      this.httpService.post<CreateTransportResponse>(path, { direction }),
    );
  }

  connectTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<ConnectTransportResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.connectTransport, {
      roomId,
      peerId,
      transportId,
    });

    return this.request(() =>
      this.httpService.post<ConnectTransportResponse>(path, {
        dtlsParameters,
      }),
    );
  }

  produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<ProduceResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.produce, {
      roomId,
      peerId,
      transportId,
    });

    return this.request(() =>
      this.httpService.post<ProduceResponse>(path, { kind, rtpParameters }),
    );
  }

  consume(
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumeResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.consume, {
      roomId,
      peerId,
    });

    return this.request(() =>
      this.httpService.post<ConsumeResponse>(path, {
        producerId,
        rtpCapabilities,
      }),
    );
  }

  resumeConsumer(
    roomId: string,
    peerId: string,
    consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.resumeConsumer, {
      roomId,
      peerId,
      consumerId,
    });

    return this.request(() =>
      this.httpService.post<ResumeConsumerResponse>(path),
    );
  }

  pauseProducer(
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<PauseProducerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.pauseProducer, {
      roomId,
      peerId,
      producerId,
    });

    return this.request(() =>
      this.httpService.post<PauseProducerResponse>(path),
    );
  }

  resumeProducer(
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<ResumeProducerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.resumeProducer, {
      roomId,
      peerId,
      producerId,
    });

    return this.request(() =>
      this.httpService.post<ResumeProducerResponse>(path),
    );
  }

  removePeer(roomId: string, peerId: string): Promise<RemovePeerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.removePeer, {
      roomId,
      peerId,
    });

    return this.request(() =>
      this.httpService.delete<RemovePeerResponse>(path),
    );
  }

  closeRoom(roomId: string): Promise<CloseRoomResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.closeRoom, { roomId });

    return this.request(() => this.httpService.delete<CloseRoomResponse>(path));
  }

  // Reconstructs a real HttpException from apps/sfu's default Nest error
  // body, so WsExceptionFilter surfaces the same message/status it would if
  // this were still an in-process NotFoundException. A connection-level
  // failure (apps/sfu unreachable, timed out) has no response body to read,
  // so it's reported as 503 rather than left to escape as a raw AxiosError,
  // which WsExceptionFilter would otherwise mask as an opaque 500.
  private async request<T>(
    call: () => Observable<AxiosResponse<T>>,
  ): Promise<T> {
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
