import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SfuClientService } from './sfu-client.service';
import { SfuRegistryService } from './sfu-registry.service';
import { SfuConfigService } from '../config/sfu-config.service';

@Module({
  imports: [
    // No fixed baseURL - every SfuClientService call is given a specific
    // node's URL (a room's pinned instance, or one being queried for load),
    // never a single shared target.
    HttpModule.register({
      // Without this, a stalled apps/sfu (e.g. a blocked mediasoup
      // worker) would leave the request pending forever - the WS
      // handler's ack never fires and no 'exception' event ever reaches
      // the client, an unrecoverable hang indistinguishable from a
      // dropped connection.
      timeout: 10000,
    }),
  ],
  providers: [SfuClientService, SfuRegistryService, SfuConfigService],
  exports: [SfuClientService, SfuRegistryService],
})
export class SfuClientModule {}
