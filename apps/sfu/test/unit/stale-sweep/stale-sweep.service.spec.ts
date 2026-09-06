import { StaleSweepService } from '../../../src/stale-sweep/stale-sweep.service';
import { StaleSweepConfigService } from '../../../src/stale-sweep/config/stale-sweep-config.service';
import { MediaRoomsService } from '../../../src/media-rooms/media-rooms.service';

describe('StaleSweepService', () => {
  let mediaRoomsService: { closeStaleRooms: jest.Mock };
  let config: StaleSweepConfigService;
  let service: StaleSweepService;

  beforeEach(() => {
    mediaRoomsService = {
      closeStaleRooms: jest.fn().mockReturnValue([]),
    };

    config = {
      thresholdMs: 30_000,
      sweepIntervalMs: 5000,
    } as StaleSweepConfigService;

    service = new StaleSweepService(
      mediaRoomsService as unknown as MediaRoomsService,
      config,
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not sweep before onModuleInit runs', async () => {
    await jest.advanceTimersByTimeAsync(20_000);

    expect(mediaRoomsService.closeStaleRooms).not.toHaveBeenCalled();
  });

  it('sweeps with the configured threshold at every configured interval', async () => {
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(5000 * 3);

    expect(mediaRoomsService.closeStaleRooms).toHaveBeenCalledTimes(3);
    expect(mediaRoomsService.closeStaleRooms).toHaveBeenCalledWith(30_000);
  });

  it('stops sweeping after module destroy', async () => {
    service.onModuleInit();
    service.onModuleDestroy();
    mediaRoomsService.closeStaleRooms.mockClear();

    await jest.advanceTimersByTimeAsync(20_000);

    expect(mediaRoomsService.closeStaleRooms).not.toHaveBeenCalled();
  });

  it('does not throw when onModuleDestroy runs before onModuleInit', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
