import { Module } from '@nestjs/common';
import { MediaContractsService } from './media-contracts.service';

@Module({
  providers: [MediaContractsService],
  exports: [MediaContractsService],
})
export class MediaContractsModule {}
