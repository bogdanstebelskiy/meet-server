import { buildMediaRoomPath, buildPath } from './build-path';
import { MEDIA_ROOM_ROUTES } from './media-room.routes';

describe('buildPath', () => {
  it('interpolates a single :token', () => {
    const path = buildPath(MEDIA_ROOM_ROUTES.createOrGetRoom, {
      roomId: 'room-1',
    });

    expect(path).toBe('room-1');
  });

  it('interpolates every :token in a multi-segment pattern, leaving literal segments untouched', () => {
    const path = buildPath(MEDIA_ROOM_ROUTES.produce, {
      roomId: 'room-1',
      peerId: 'peer-1',
      transportId: 'transport-1',
    });

    expect(path).toBe('room-1/peers/peer-1/transports/transport-1/produce');
  });
});

describe('buildMediaRoomPath', () => {
  it('prepends the media-rooms base path to the interpolated route', () => {
    const path = buildMediaRoomPath(MEDIA_ROOM_ROUTES.removePeer, {
      roomId: 'room-1',
      peerId: 'peer-1',
    });

    expect(path).toBe('/media-rooms/room-1/peers/peer-1');
  });
});
