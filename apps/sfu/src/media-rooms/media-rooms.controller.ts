import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { MEDIA_ROOM_ROUTES, MEDIA_ROOMS_BASE_PATH } from '@app/media-contracts';
import type {
  CloseRoomResponse,
  ConnectTransportRequest,
  ConnectTransportResponse,
  ConsumeRequest,
  ConsumeResponse,
  CreateTransportRequest,
  CreateTransportResponse,
  MediaRoomResponse,
  MediaRoomsStatsResponse,
  PauseProducerResponse,
  ProduceRequest,
  ProduceResponse,
  RemovePeerResponse,
  ResumeConsumerResponse,
  ResumeProducerResponse,
} from '@app/media-contracts';
import { MediaRoomsService } from './media-rooms.service';

@Controller(MEDIA_ROOMS_BASE_PATH)
export class MediaRoomsController {
  constructor(private readonly mediaRoomsService: MediaRoomsService) {}

  @Get(MEDIA_ROOM_ROUTES.stats)
  stats(): MediaRoomsStatsResponse {
    return { roomCount: this.mediaRoomsService.roomCount };
  }

  @Put(MEDIA_ROOM_ROUTES.createOrGetRoom)
  async createOrGetRoom(
    @Param('roomId') roomId: string,
  ): Promise<MediaRoomResponse> {
    const room = await this.mediaRoomsService.getOrCreateRoom(roomId);

    return { roomId: room.id, rtpCapabilities: room.router.rtpCapabilities };
  }

  @Post(MEDIA_ROOM_ROUTES.createTransport)
  async createTransport(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Body() { direction }: CreateTransportRequest,
  ): Promise<CreateTransportResponse> {
    const transport = await this.mediaRoomsService.createTransport(
      roomId,
      peerId,
      direction,
    );

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  @Post(MEDIA_ROOM_ROUTES.connectTransport)
  @HttpCode(200)
  async connectTransport(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('transportId') transportId: string,
    @Body() { dtlsParameters }: ConnectTransportRequest,
  ): Promise<ConnectTransportResponse> {
    await this.mediaRoomsService.connectTransport(
      roomId,
      peerId,
      transportId,
      dtlsParameters,
    );

    return { connected: true };
  }

  @Post(MEDIA_ROOM_ROUTES.produce)
  async produce(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('transportId') transportId: string,
    @Body() { kind, rtpParameters }: ProduceRequest,
  ): Promise<ProduceResponse> {
    const producer = await this.mediaRoomsService.produce(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters,
    );

    return { id: producer.id };
  }

  @Post(MEDIA_ROOM_ROUTES.consume)
  async consume(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Body() { producerId, rtpCapabilities }: ConsumeRequest,
  ): Promise<ConsumeResponse> {
    const consumer = await this.mediaRoomsService.consume(
      roomId,
      peerId,
      producerId,
      rtpCapabilities,
    );

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      producerPaused: consumer.producerPaused,
    };
  }

  @Post(MEDIA_ROOM_ROUTES.resumeConsumer)
  @HttpCode(200)
  async resumeConsumer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('consumerId') consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    await this.mediaRoomsService.resumeConsumer(roomId, peerId, consumerId);

    return { resumed: true };
  }

  @Post(MEDIA_ROOM_ROUTES.pauseProducer)
  @HttpCode(200)
  async pauseProducer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('producerId') producerId: string,
  ): Promise<PauseProducerResponse> {
    await this.mediaRoomsService.pauseProducer(roomId, peerId, producerId);

    return { paused: true };
  }

  @Post(MEDIA_ROOM_ROUTES.resumeProducer)
  @HttpCode(200)
  async resumeProducer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('producerId') producerId: string,
  ): Promise<ResumeProducerResponse> {
    await this.mediaRoomsService.resumeProducer(roomId, peerId, producerId);

    return { resumed: true };
  }

  @Delete(MEDIA_ROOM_ROUTES.removePeer)
  @HttpCode(200)
  removePeer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
  ): RemovePeerResponse {
    this.mediaRoomsService.removePeer(roomId, peerId);

    return { removed: true };
  }

  @Delete(MEDIA_ROOM_ROUTES.closeRoom)
  @HttpCode(200)
  closeRoom(@Param('roomId') roomId: string): CloseRoomResponse {
    const closed = this.mediaRoomsService.closeRoom(roomId);

    return { closed };
  }
}
