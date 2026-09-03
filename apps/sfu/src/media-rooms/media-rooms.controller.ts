import { Body, Controller, HttpCode, Param, Post, Put } from '@nestjs/common';
import type {
  ConnectTransportRequest,
  ConnectTransportResponse,
  ConsumeRequest,
  ConsumeResponse,
  CreateTransportRequest,
  CreateTransportResponse,
  MediaRoomResponse,
  PauseProducerResponse,
  ProduceRequest,
  ProduceResponse,
  ResumeConsumerResponse,
  ResumeProducerResponse,
} from '@app/media-contracts';
import { MediaRoomsService } from './media-rooms.service';

@Controller('media-rooms')
export class MediaRoomsController {
  constructor(private readonly mediaRoomsService: MediaRoomsService) {}

  @Put(':roomId')
  async createOrGetRoom(
    @Param('roomId') roomId: string,
  ): Promise<MediaRoomResponse> {
    const room = await this.mediaRoomsService.getOrCreateRoom(roomId);

    return { roomId: room.id, rtpCapabilities: room.router.rtpCapabilities };
  }

  @Post(':roomId/peers/:peerId/transports')
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

  @Post(':roomId/peers/:peerId/transports/:transportId/connect')
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

  @Post(':roomId/peers/:peerId/transports/:transportId/produce')
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

  @Post(':roomId/peers/:peerId/consumers')
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

  @Post(':roomId/peers/:peerId/consumers/:consumerId/resume')
  @HttpCode(200)
  async resumeConsumer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('consumerId') consumerId: string,
  ): Promise<ResumeConsumerResponse> {
    await this.mediaRoomsService.resumeConsumer(roomId, peerId, consumerId);

    return { resumed: true };
  }

  @Post(':roomId/peers/:peerId/producers/:producerId/pause')
  @HttpCode(200)
  async pauseProducer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('producerId') producerId: string,
  ): Promise<PauseProducerResponse> {
    await this.mediaRoomsService.pauseProducer(roomId, peerId, producerId);

    return { paused: true };
  }

  @Post(':roomId/peers/:peerId/producers/:producerId/resume')
  @HttpCode(200)
  async resumeProducer(
    @Param('roomId') roomId: string,
    @Param('peerId') peerId: string,
    @Param('producerId') producerId: string,
  ): Promise<ResumeProducerResponse> {
    await this.mediaRoomsService.resumeProducer(roomId, peerId, producerId);

    return { resumed: true };
  }
}
