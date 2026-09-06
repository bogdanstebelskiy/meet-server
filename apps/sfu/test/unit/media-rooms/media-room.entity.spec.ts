import { MediaRoom } from '../../../src/media-rooms/entities/media-room.entity';

describe('MediaRoom entity', () => {
  const router = { close: jest.fn() } as any;
  const worker = {} as any;

  describe('lastActivityAt / touch', () => {
    it('is set to the creation time by default', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      expect(room.lastActivityAt).toBe(1000);
    });

    it('touch() moves lastActivityAt forward to the given time', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      room.touch(5000);

      expect(room.lastActivityAt).toBe(5000);
    });

    it('touch() defaults to Date.now() when no time is given', () => {
      jest.useFakeTimers().setSystemTime(12345);
      const room = new MediaRoom('room-1', router, worker, 0);

      room.touch();

      expect(room.lastActivityAt).toBe(12345);
      jest.useRealTimers();
    });
  });

  describe('isStaleAsOf', () => {
    it('is not stale when elapsed time is under the threshold', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      expect(room.isStaleAsOf(1000 + 500, 1000)).toBe(false);
    });

    it('is not stale when elapsed time exactly equals the threshold', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      expect(room.isStaleAsOf(1000 + 1000, 1000)).toBe(false);
    });

    it('is stale once elapsed time exceeds the threshold', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      expect(room.isStaleAsOf(1000 + 1001, 1000)).toBe(true);
    });

    it('reflects a touch() that resets the clock', () => {
      const room = new MediaRoom('room-1', router, worker, 1000);

      room.touch(4000);

      expect(room.isStaleAsOf(4000 + 500, 1000)).toBe(false);
    });
  });
});
