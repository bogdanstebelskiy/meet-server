import { Injectable, Logger } from '@nestjs/common';
import { OpusEncoder } from '@discordjs/opus';
import { createSocket } from 'dgram';
import { mkdir, open, writeFile } from 'fs/promises';
import { join } from 'path';
import type { PlainTransport, Producer } from 'mediasoup/types';
import { RecordingConfigService } from '../config/recording-config.service';
import type { RecordingSession } from './types';
import {
  BITS_PER_SAMPLE,
  BYTES_PER_SAMPLE,
  CHANNELS,
  MAX_SILENCE_GAP_TICKS,
  OPUS_FRAME_SAMPLES,
  RTP_HEADER_MIN_SIZE,
  SAMPLE_RATE,
  TARGET_FRAME_SAMPLES,
  WAV_HEADER_SIZE,
} from './constants';
import { MediaRoom } from '../media-rooms/entities/media-room.entity';
import { MediaPeer } from '../media-rooms/entities/media-peer.entity';

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(private readonly recordingConfig: RecordingConfigService) {}

  async startRoomRecording(
    room: MediaRoom,
    peers: Array<{ peerId: string; displayName: string }>,
  ): Promise<void> {
    room.recording = true;

    for (const { peerId, displayName } of peers) {
      const peer = room.getPeer(peerId);

      if (!peer) {
        continue;
      }

      peer.displayName = displayName;
    }

    const tapPromises: Promise<void>[] = [];

    for (const peer of room.peers.values()) {
      const audioProducer = this.findAudioProducer(peer);

      if (audioProducer) {
        tapPromises.push(this.tapPeer(room, peer, audioProducer));
      }
    }

    await Promise.all(tapPromises);
  }

  async stopRoomRecording(room: MediaRoom): Promise<string> {
    room.recording = false;
    const outputDir = this.roomOutputDir(room.id);

    const stopPromises: Promise<void>[] = [];

    for (const peer of room.peers.values()) {
      stopPromises.push(this.stopPeerRecording(peer));
    }

    await Promise.all(stopPromises);

    await this.writeMeetingJson(room, outputDir);

    return outputDir;
  }

  async tapProducerIfRecording(
    room: MediaRoom,
    peer: MediaPeer,
    producer: Producer,
  ): Promise<void> {
    if (!room.recording || producer.kind !== 'audio') {
      return;
    }

    if (peer.recordingConsumer && !peer.recordingConsumer.closed) {
      return;
    }

    await this.tapPeer(room, peer, producer);
  }

  private async tapPeer(room: MediaRoom, peer: MediaPeer, audioProducer: Producer): Promise<void> {
    await this.stopPeerRecording(peer);

    const outputDir = this.roomOutputDir(room.id);
    await mkdir(outputDir, { recursive: true });

    const speakerName = peer.displayName ?? peer.id;
    const outputPath = join(outputDir, `${this.sanitizeFilename(speakerName)}.wav`);

    const listenIp = this.recordingConfig.listenIp;
    let plainTransport: PlainTransport;

    try {
      plainTransport = await room.router.createPlainTransport({
        listenInfo: { protocol: 'udp', ip: listenIp },
        rtcpMux: true,
        comedia: false,
      });
    } catch (error) {
      this.logger.error(`Failed to create PlainTransport for peer ${peer.id}`, error);
      return;
    }

    peer.plainTransport = plainTransport;

    let consumer: Awaited<ReturnType<PlainTransport['consume']>>;

    try {
      consumer = await plainTransport.consume({
        producerId: audioProducer.id,
        rtpCapabilities: room.router.rtpCapabilities,
        paused: false,
      });
    } catch (error) {
      this.logger.error(`Failed to create recording consumer for peer ${peer.id}`, error);
      plainTransport.close();
      peer.plainTransport = undefined;
      return;
    }

    peer.recordingConsumer = consumer;

    consumer.on('producerclose', () => {
      this.logger.log(`Recording producer closed for peer ${peer.id}, cleaning up`);
      this.stopPeerRecording(peer).catch((error) =>
        this.logger.error(`Failed to clean up recording for peer ${peer.id}`, error),
      );
    });

    const { session, port } = await this.startRecordingSession(outputPath, listenIp);
    peer.recordingSession = session;

    try {
      await plainTransport.connect({ ip: listenIp, port });
    } catch (error) {
      this.logger.error(`Failed to connect PlainTransport for peer ${peer.id}`, error);
      await this.stopPeerRecording(peer);
      return;
    }

    this.logger.log(`Recording peer ${peer.id} (${speakerName}) to ${outputPath}`);
  }

  private async startRecordingSession(
    outputPath: string,
    listenIp: string,
  ): Promise<{ session: RecordingSession; port: number }> {
    const decoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
    const fileHandle = await open(outputPath, 'w');
    const header = this.buildWavHeader();
    await fileHandle.write(header);

    const socket = createSocket('udp4');

    await new Promise<void>((resolve, reject) => {
      socket.once('listening', resolve);
      socket.once('error', reject);
      socket.bind(0, listenIp);
    });

    const port = socket.address().port;

    const session: RecordingSession = {
      socket,
      fileHandle,
      decoder,
      bytesWritten: 0,
      outputPath,
      lastRtpTimestamp: undefined,
      closed: false,
    };

    socket.on('message', (msg) => {
      this.handleRtpPacket(session, msg);
    });

    socket.on('error', (error) => {
      this.logger.error(`UDP socket error for ${outputPath}`, error);
      this.closeRecordingSession(session).catch((err) =>
        this.logger.error(`Failed to close session after socket error`, err),
      );
    });

    return { session, port };
  }

  private handleRtpPacket(session: RecordingSession, msg: Buffer): void {
    if (session.closed) {
      return;
    }

    if (msg.length < RTP_HEADER_MIN_SIZE) {
      return;
    }

    const firstByte = msg[0];
    const version = (firstByte >> 6) & 0x03;

    if (version !== 2) {
      return;
    }

    const csrcCount = firstByte & 0x0f;
    const hasExtension = ((firstByte >> 4) & 0x01) === 1;
    let payloadOffset = RTP_HEADER_MIN_SIZE + csrcCount * 4;

    if (hasExtension) {
      if (msg.length < payloadOffset + 4) {
        return;
      }

      const extensionLength = msg.readUInt16BE(payloadOffset + 2);
      payloadOffset += 4 + extensionLength * 4;
    }

    if (payloadOffset >= msg.length) {
      return;
    }

    const rtpTimestamp = msg.readUInt32BE(4);
    const opusPayload = msg.subarray(payloadOffset);

    if (session.lastRtpTimestamp !== undefined) {
      const gap = (rtpTimestamp - session.lastRtpTimestamp) >>> 0;
      const isGapLargerThanOneFrame = gap > OPUS_FRAME_SAMPLES;
      const isGapWithinLimit = gap < MAX_SILENCE_GAP_TICKS;

      if (isGapLargerThanOneFrame && isGapWithinLimit) {
        const gapAtTargetRate = Math.floor((gap / OPUS_FRAME_SAMPLES) * TARGET_FRAME_SAMPLES);
        const silenceBytes = gapAtTargetRate * BYTES_PER_SAMPLE;
        const silence = Buffer.alloc(silenceBytes);
        session.fileHandle.write(silence).catch(() => {});
        session.bytesWritten += silenceBytes;
      }
    }

    session.lastRtpTimestamp = rtpTimestamp;

    let pcm: Buffer;

    try {
      pcm = session.decoder.decode(opusPayload);
    } catch {
      return;
    }

    session.fileHandle.write(pcm).catch(() => {});
    session.bytesWritten += pcm.length;
  }

  private buildWavHeader(): Buffer {
    const header = Buffer.alloc(WAV_HEADER_SIZE);
    const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
    const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write('data', 36);
    header.writeUInt32LE(0, 40);

    return header;
  }

  private async stopPeerRecording(peer: MediaPeer): Promise<void> {
    if (peer.recordingConsumer && !peer.recordingConsumer.closed) {
      peer.recordingConsumer.close();
    }
    peer.recordingConsumer = undefined;

    if (peer.plainTransport && !peer.plainTransport.closed) {
      peer.plainTransport.close();
    }
    peer.plainTransport = undefined;

    const session = peer.recordingSession;
    peer.recordingSession = undefined;

    if (!session) {
      return;
    }

    await this.closeRecordingSession(session);
  }

  private async closeRecordingSession(session: RecordingSession): Promise<void> {
    if (session.closed) {
      return;
    }

    session.closed = true;
    session.socket.close();

    const riffSize = Buffer.alloc(4);
    riffSize.writeUInt32LE(session.bytesWritten + WAV_HEADER_SIZE - 8);
    await session.fileHandle.write(riffSize, 0, 4, 4);

    const dataSize = Buffer.alloc(4);
    dataSize.writeUInt32LE(session.bytesWritten);
    await session.fileHandle.write(dataSize, 0, 4, 40);

    await session.fileHandle.close();

    this.logger.log(`Closed recording ${session.outputPath} (${session.bytesWritten} bytes PCM)`);
  }

  private findAudioProducer(peer: MediaPeer): Producer | undefined {
    for (const producer of peer.producers.values()) {
      if (producer.kind === 'audio' && !producer.closed) {
        return producer;
      }
    }
  }

  private async writeMeetingJson(room: MediaRoom, outputDir: string): Promise<void> {
    const participants: string[] = [];

    for (const peer of room.peers.values()) {
      participants.push(peer.displayName ?? peer.id);
    }

    const meeting = {
      meeting_id: room.id,
      title: room.id,
      date: room.createdAt.toISOString().slice(0, 10),
      participants,
    };

    const filePath = join(outputDir, 'meeting.json');
    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(meeting, null, 2));
    this.logger.log(`Wrote ${filePath}`);
  }

  private roomOutputDir(roomId: string): string {
    return join(this.recordingConfig.outputDir, this.sanitizeFilename(roomId));
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}
