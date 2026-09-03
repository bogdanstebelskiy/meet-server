import { Module } from '@nestjs/common';
import { SfuController } from './sfu.controller';
import { SfuService } from './sfu.service';

@Module({
  imports: [],
  controllers: [SfuController],
  providers: [SfuService],
})
export class SfuModule {}
