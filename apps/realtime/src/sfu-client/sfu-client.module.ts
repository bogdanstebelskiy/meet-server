import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SfuClientService } from './sfu-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>(
          'SFU_SERVICE_URL',
          'http://localhost:3001',
        ),
        // Without this, a stalled apps/sfu (e.g. a blocked mediasoup
        // worker) would leave the request pending forever - the WS
        // handler's ack never fires and no 'exception' event ever reaches
        // the client, an unrecoverable hang indistinguishable from a
        // dropped connection.
        timeout: 10000,
      }),
    }),
  ],
  providers: [SfuClientService],
  exports: [SfuClientService],
})
export class SfuClientModule {}
