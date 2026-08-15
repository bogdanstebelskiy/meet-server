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

// Must be this machine's real LAN IP, not 127.0.0.1 or 0.0.0.0 - Firefox
// won't pair a real local ICE candidate against a loopback remote one, and
// 0.0.0.0 isn't connectable at all. Update to your own machine's IP
// (ipconfig/ifconfig) when running on a different machine or network.
export const webRtcAnnouncedAddress = '10.214.228.187';
