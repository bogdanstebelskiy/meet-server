import { Module } from '@nestjs/common';
import { WorkerPoolService } from './worker-pool.service';

@Module({
  providers: [WorkerPoolService],
  exports: [WorkerPoolService],
})
export class WorkersModule {}
