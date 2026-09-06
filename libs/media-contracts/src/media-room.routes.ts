// Single source of truth for the media-rooms REST route shapes - both
// MediaRoomsController's @Controller prefix/route decorators and
// SfuClientService's URL building read from these, so a changed route can't
// drift between the two apps unnoticed.
export const MEDIA_ROOMS_BASE_PATH = 'media-rooms';

// Patterns are relative to MEDIA_ROOMS_BASE_PATH.
export const MEDIA_ROOM_ROUTES = {
  stats: 'stats',
  createOrGetRoom: ':roomId',
  createTransport: ':roomId/peers/:peerId/transports',
  connectTransport: ':roomId/peers/:peerId/transports/:transportId/connect',
  produce: ':roomId/peers/:peerId/transports/:transportId/produce',
  consume: ':roomId/peers/:peerId/consumers',
  resumeConsumer: ':roomId/peers/:peerId/consumers/:consumerId/resume',
  pauseProducer: ':roomId/peers/:peerId/producers/:producerId/pause',
  resumeProducer: ':roomId/peers/:peerId/producers/:producerId/resume',
  removePeer: ':roomId/peers/:peerId',
  closeRoom: ':roomId',
} as const;
