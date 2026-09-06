import type { MediaRoomErrorCode } from '@app/media-contracts';

export interface HttpExceptionBody {
  statusCode?: number;
  message?: string;
  errorCode?: MediaRoomErrorCode;
}

// Issue #34: the two failure shapes request() distinguishes when deciding
// whether a room's MediaRoom needs recovering - 'unreachable' (apps/sfu
// couldn't be reached at all) vs 'not-found' (reached, but that roomId's
// MediaRoom isn't there, e.g. after an sfu restart).
export type SfuFailureReason = 'unreachable' | 'not-found';

export interface SfuFailureEvent {
  roomId: string;
  reason: SfuFailureReason;
}
