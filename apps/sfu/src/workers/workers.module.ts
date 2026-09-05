import { Module } from '@nestjs/common';
import { WorkerPoolService } from './worker-pool.service';
import { WorkerSettingsConfigService } from '../config/worker-settings-config.service';

@Module({
  providers: [WorkerPoolService, WorkerSettingsConfigService],
  exports: [WorkerPoolService],
})
export class WorkersModule {}
