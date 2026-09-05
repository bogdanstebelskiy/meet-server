import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorkersModule } from './workers/workers.module';
import { MediaRoomsModule } from './media-rooms/media-rooms.module';
import { InstanceRegistryModule } from './instance-registry/instance-registry.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WorkersModule,
    MediaRoomsModule,
    InstanceRegistryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
