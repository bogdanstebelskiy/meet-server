import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SfuClientService } from './sfu-client.service';
import { SessionsModule } from '../sessions/sessions.module';
import { SfuFailureEmitter } from './sfu-failure.emitter';

@Module({
  imports: [
    SessionsModule,
    HttpModule.register({
      // Without this, a stalled apps/sfu (e.g. a blocked mediasoup worker)
      // would leave the request pending forever - the WS handler's ack
      // never fires and no 'exception' event ever reaches the client, an
      // unrecoverable hang indistinguishable from a dropped connection.
      timeout: 10000,
    }),
  ],
  providers: [SfuClientService, SfuFailureEmitter],
  exports: [SfuClientService, SfuFailureEmitter],
})
export class SfuClientModule {}
