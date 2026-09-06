import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

// The seam SfuClientService reports a room's sfu failures through, and
// RecoveryService (issue #34) listens on - decouples "detecting a failure"
// from "reacting to one" so neither module needs to import the other.
@Injectable()
export class SfuFailureEmitter extends EventEmitter {}
