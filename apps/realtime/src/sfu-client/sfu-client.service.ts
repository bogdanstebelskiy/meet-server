import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, type Observable } from 'rxjs';
import { isAxiosError, type AxiosResponse } from 'axios';
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
    return this.request(() =>
      this.httpService.put<MediaRoomResponse>(`/media-rooms/${roomId}`),
    );
  }

  createTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirection,
  ): Promise<CreateTransportResponse> {
    return this.request(() =>
      this.httpService.post<CreateTransportResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/transports`,
        { direction },
      ),
    );
  }

  connectTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<ConnectTransportResponse> {
    return this.request(() =>
      this.httpService.post<ConnectTransportResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/transports/${transportId}/connect`,
        { dtlsParameters },
      ),
    );
  }

  produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<ProduceResponse> {
    return this.request(() =>
      this.httpService.post<ProduceResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/transports/${transportId}/produce`,
        { kind, rtpParameters },
      ),
    );
  }

  consume(
    roomId: string,
    peerId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumeResponse> {
    return this.request(() =>
      this.httpService.post<ConsumeResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/consumers`,
        { producerId, rtpCapabilities },
      ),
    );
  }

  resumeConsumer(
    roomId: string,
    peerId: string,
    consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    return this.request(() =>
      this.httpService.post<ResumeConsumerResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/consumers/${consumerId}/resume`,
      ),
    );
  }

  pauseProducer(
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<PauseProducerResponse> {
    return this.request(() =>
      this.httpService.post<PauseProducerResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/producers/${producerId}/pause`,
      ),
    );
  }

  resumeProducer(
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<ResumeProducerResponse> {
    return this.request(() =>
      this.httpService.post<ResumeProducerResponse>(
        `/media-rooms/${roomId}/peers/${peerId}/producers/${producerId}/resume`,
      ),
    );
  }

  removePeer(roomId: string, peerId: string): Promise<RemovePeerResponse> {
    return this.request(() =>
      this.httpService.delete<RemovePeerResponse>(
        `/media-rooms/${roomId}/peers/${peerId}`,
      ),
    );
  }

  closeRoom(roomId: string): Promise<CloseRoomResponse> {
    return this.request(() =>
      this.httpService.delete<CloseRoomResponse>(`/media-rooms/${roomId}`),
    );
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
      const response = await firstValueFrom(call());

      return response.data;
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response) {
          const body = error.response.data as HttpExceptionBody;

          throw new HttpException(
            body.message ?? error.message,
            body.statusCode ?? error.response.status,
          );
        }

        throw new HttpException(
          `apps/sfu is unreachable: ${error.message}`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      throw error;
    }
  }
}
