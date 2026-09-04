import { MEDIA_ROOMS_BASE_PATH } from './media-room.routes';

// Interpolates a MEDIA_ROOM_ROUTES pattern (":roomId/peers/:peerId") with
// actual values, the same ":token" syntax Nest's own route decorators use.
export function buildPath(
  pattern: string,
  params: Record<string, string>,
): string {
  const segments = pattern.split('/');
  const resolvedSegments = segments.map((segment) => {
    if (segment.startsWith(':')) {
      const key = segment.slice(1);
      return params[key];
    }

    return segment;
  });

  const path = resolvedSegments.join('/');
  return path;
}

// Same as buildPath, but also prepends MEDIA_ROOMS_BASE_PATH - the full path
// SfuClientService actually calls, mirroring MediaRoomsController's
// @Controller(MEDIA_ROOMS_BASE_PATH) + route-decorator pattern combination.
export function buildMediaRoomPath(
  pattern: string,
  params: Record<string, string>,
): string {
  const path = buildPath(pattern, params);
  return `/${MEDIA_ROOMS_BASE_PATH}/${path}`;
}
