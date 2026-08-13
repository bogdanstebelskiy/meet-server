import { Module } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { SfuController } from './sfu.controller';

@Module({
  controllers: [SfuController],
  providers: [SfuService],
})
export class SfuModule {}
