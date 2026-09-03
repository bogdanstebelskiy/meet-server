import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { SfuModule } from '../sfu/sfu.module';

@Module({
  imports: [SfuModule],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
