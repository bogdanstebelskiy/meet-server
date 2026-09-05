import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { InstanceRegistryConfigService } from './config/instance-registry-config.service';
import { InstanceRegistryService } from './instance-registry.service';
import { MediaRoomsModule } from '../media-rooms/media-rooms.module';

@Module({
  imports: [RedisModule, MediaRoomsModule],
  providers: [InstanceRegistryConfigService, InstanceRegistryService],
})
export class InstanceRegistryModule {}
