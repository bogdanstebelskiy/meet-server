import type {
  RouterRtpCodecCapability,
  TransportPortRange,
  WorkerSettings,
} from 'mediasoup/types';

export const mediaCodecs: RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

export const workerSettings: WorkerSettings = {
  logLevel: 'debug',
  logTags: ['info', 'ice', 'dtls', 'rtcp'],
};

export const webRtcPortRange: TransportPortRange = {
  min: 40000,
  max: 49999,
};
