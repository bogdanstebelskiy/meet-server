import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { SfuClientModule } from '../sfu-client/sfu-client.module';

@Module({
  imports: [SfuClientModule],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
