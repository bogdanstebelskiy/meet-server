import { InstanceRegistryService } from '../../../src/instance-registry/instance-registry.service';
import { InstanceRegistryConfigService } from '../../../src/instance-registry/config/instance-registry-config.service';
import { MediaRoomsService } from '../../../src/media-rooms/media-rooms.service';
import { INSTANCE_KEY_PREFIX } from '../../../src/instance-registry/constants';

describe('InstanceRegistryService', () => {
  let redis: { set: jest.Mock; del: jest.Mock; disconnect: jest.Mock };
  let config: InstanceRegistryConfigService;
  let mediaRoomsService: { getTotalConsumerCount: jest.Mock };
  let service: InstanceRegistryService;

  const advertisedUrl = 'http://sfu-1.internal:3001';

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
    };

    config = {
      advertisedUrl,
      heartbeatIntervalMs: 5000,
      ttlSeconds: 15,
    } as InstanceRegistryConfigService;

    mediaRoomsService = {
      getTotalConsumerCount: jest.fn().mockReturnValue(0),
    };

    service = new InstanceRegistryService(
      redis as never,
      config,
      mediaRoomsService as unknown as MediaRoomsService,
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the instance key with current load and TTL immediately on init', () => {
    mediaRoomsService.getTotalConsumerCount.mockReturnValue(7);

    service.onModuleInit();

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redis.set.mock.calls[0];
    expect(key).toBe(`${INSTANCE_KEY_PREFIX}${advertisedUrl}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(15);
    expect(JSON.parse(value)).toMatchObject({ load: 7 });
  });

  it('refreshes the key on every subsequent tick at the configured interval', async () => {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000 * 3);

    // The immediate publish on init, plus one per elapsed interval.
    expect(redis.set).toHaveBeenCalledTimes(4);
  });

  it('does not schedule any heartbeat when SFU_ADVERTISED_URL is unset', async () => {
    config = {
      advertisedUrl: undefined,
      heartbeatIntervalMs: 5000,
      ttlSeconds: 15,
    } as InstanceRegistryConfigService;

    service = new InstanceRegistryService(
      redis as never,
      config,
      mediaRoomsService as unknown as MediaRoomsService,
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(20000);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('keeps ticking on a following interval when a heartbeat write rejects', async () => {
    redis.set.mockRejectedValueOnce(new Error('connection refused'));

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000 * 2);

    // The rejecting immediate publish, plus one per elapsed interval.
    expect(redis.set).toHaveBeenCalledTimes(3);
  });

  it('deletes its own key on graceful module destroy', async () => {
    service.onModuleInit();
    await service.onModuleDestroy();

    expect(redis.del).toHaveBeenCalledWith(
      `${INSTANCE_KEY_PREFIX}${advertisedUrl}`,
    );
  });

  it('disconnects the Redis client on module destroy, so no reconnect timer outlives shutdown', async () => {
    service.onModuleInit();
    await service.onModuleDestroy();

    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stops ticking after module destroy', async () => {
    service.onModuleInit();
    await service.onModuleDestroy();
    redis.set.mockClear();
    await jest.advanceTimersByTimeAsync(20000);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('does not attempt to delete a key when SFU_ADVERTISED_URL was never set', async () => {
    config = {
      advertisedUrl: undefined,
      heartbeatIntervalMs: 5000,
      ttlSeconds: 15,
    } as InstanceRegistryConfigService;

    service = new InstanceRegistryService(
      redis as never,
      config,
      mediaRoomsService as unknown as MediaRoomsService,
    );

    service.onModuleInit();
    await service.onModuleDestroy();

    expect(redis.del).not.toHaveBeenCalled();
  });

  it('does not throw when the DEL on destroy rejects', async () => {
    redis.del.mockRejectedValueOnce(new Error('connection refused'));

    service.onModuleInit();

    await expect(service.onModuleDestroy()).resolves.not.toThrow();
  });
});
