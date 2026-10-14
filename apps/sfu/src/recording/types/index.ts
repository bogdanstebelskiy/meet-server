import type { Socket } from 'dgram';
import type { FileHandle } from 'fs/promises';
import type { OpusEncoder } from '@discordjs/opus';

export interface RecordingSession {
  socket: Socket;
  fileHandle: FileHandle;
  decoder: OpusEncoder;
  bytesWritten: number;
  outputPath: string;
  lastRtpTimestamp: number | undefined;
  closed: boolean;
}
