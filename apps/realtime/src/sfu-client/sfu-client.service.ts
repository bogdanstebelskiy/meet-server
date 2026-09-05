import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
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
import { SessionsService } from '../sessions/sessions.service';
import type { HttpExceptionBody } from './types';

@Injectable()
export class SfuClientService {
  private readonly logger = new Logger(SfuClientService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly sessionsService: SessionsService,
  ) {}

  createOrGetMediaRoom(
    instanceUrl: string,
    roomId: string,
  ): Promise<MediaRoomResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.createOrGetRoom, {
      roomId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.put<MediaRoomResponse>(url);

    return this.request(roomId, call);
  }

  createTransport(
    instanceUrl: string,
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ): Promise<CreateTransportResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.createTransport, {
      roomId,
      peerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () =>
      this.httpService.post<CreateTransportResponse>(url, { direction });

    return this.request(roomId, call);
  }

  connectTransport(
    instanceUrl: string,
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
    const url = `${instanceUrl}${path}`;
    const call = () =>
      this.httpService.post<ConnectTransportResponse>(url, {
        dtlsParameters,
      });

    return this.request(roomId, call);
  }

  produce(
    instanceUrl: string,
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
    const url = `${instanceUrl}${path}`;
    const call = () =>
      this.httpService.post<ProduceResponse>(url, { kind, rtpParameters });

    return this.request(roomId, call);
  }

  consume(
    instanceUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumeResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.consume, {
      roomId,
      peerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () =>
      this.httpService.post<ConsumeResponse>(url, {
        producerId,
        rtpCapabilities,
      });

    return this.request(roomId, call);
  }

  resumeConsumer(
    instanceUrl: string,
    roomId: string,
    peerId: string,
    consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.resumeConsumer, {
      roomId,
      peerId,
      consumerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.post<ResumeConsumerResponse>(url);

    return this.request(roomId, call);
  }

  pauseProducer(
    instanceUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<PauseProducerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.pauseProducer, {
      roomId,
      peerId,
      producerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.post<PauseProducerResponse>(url);

    return this.request(roomId, call);
  }

  resumeProducer(
    instanceUrl: string,
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<ResumeProducerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.resumeProducer, {
      roomId,
      peerId,
      producerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.post<ResumeProducerResponse>(url);

    return this.request(roomId, call);
  }

  removePeer(
    instanceUrl: string,
    roomId: string,
    peerId: string,
  ): Promise<RemovePeerResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.removePeer, {
      roomId,
      peerId,
    });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.delete<RemovePeerResponse>(url);

    return this.request(roomId, call);
  }

  closeRoom(instanceUrl: string, roomId: string): Promise<CloseRoomResponse> {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.closeRoom, { roomId });
    const url = `${instanceUrl}${path}`;
    const call = () => this.httpService.delete<CloseRoomResponse>(url);

    return this.request(roomId, call);
  }

  // Reconstructs a real HttpException from apps/sfu's default Nest error
  // body, so WsExceptionFilter surfaces the same message/status it would if
  // this were still an in-process NotFoundException. A connection-level
  // failure (apps/sfu unreachable, timed out) has no response body to read,
  // so it's reported as 503 rather than left to escape as a raw AxiosError,
  // which WsExceptionFilter would otherwise mask as an opaque 500.
  private async request<T>(
    roomId: string,
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
        // Couldn't reach the instance (refused, timed out, DNS) - maybe just
        // a blip, not necessarily dead, but invalidating is cheap and beats
        // staying pinned here for the rest of the TTL either way.
        // Best-effort: a Redis hiccup here must not mask the 503 below.
        try {
          await this.sessionsService.invalidate(roomId);
        } catch (invalidateError) {
          this.logger.error(
            `Failed to invalidate session for room ${roomId}`,
            invalidateError,
          );
        }

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
