import { Module } from '@nestjs/common';
import { RecoveryService } from './recovery.service';
import { RoomsModule } from '../rooms/rooms.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SfuClientModule } from '../sfu-client/sfu-client.module';
import { BroadcastModule } from '../broadcast/broadcast.module';

// Imported directly by AppModule (nothing else injects RecoveryService) so
// Nest instantiates it and its onModuleInit subscription actually runs.
@Module({
  imports: [RoomsModule, SessionsModule, SfuClientModule, BroadcastModule],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
