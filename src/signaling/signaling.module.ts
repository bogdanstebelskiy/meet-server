import { Module } from '@nestjs/common';
import { SignalingService } from './signaling.service';
import { SignalingGateway } from './signaling.gateway';

@Module({
  providers: [SignalingGateway, SignalingService],
})
export class SignalingModule {}
