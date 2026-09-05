import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from '../../../src/sessions/sessions.service';
import { SfuConfigService } from '../../../src/config/sfu-config.service';
import { REDIS_CLIENT } from '../../../src/redis/redis.provider';
import { FakeRedis } from '../fakes/fake-redis';
import type { InstanceRecord } from '../../../src/sessions/types';

describe('SessionsService', () => {
  let service: SessionsService;
  let redis: FakeRedis;
  let sfuConfig: { serviceUrl: string };

  async function seedInstance(url: string, load: number): Promise<void> {
    const record: InstanceRecord = {
      load,
      updatedAt: new Date().toISOString(),
    };
    await redis.set(`sfu:instance:${url}`, JSON.stringify(record), 'EX', 15);
  }

  beforeEach(async () => {
    redis = new FakeRedis();
    sfuConfig = { serviceUrl: 'http://localhost:3001' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SfuConfigService, useValue: sfuConfig },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  describe('assign', () => {
    it('falls back to the configured SFU_SERVICE_URL when no instances are registered', async () => {
      const instanceUrl = await service.assign('room-1');

      expect(instanceUrl).toBe('http://localhost:3001');
      expect(await redis.get('session:room-1')).toBe('http://localhost:3001');
    });

    it('sets a TTL on the session key', async () => {
      await service.assign('room-1');

      expect(redis.ttlOf('session:room-1')).toBe(30);
    });

    it('picks the least-loaded live instance', async () => {
      await seedInstance('http://sfu-a:3001', 5);
      await seedInstance('http://sfu-b:3001', 2);
      await seedInstance('http://sfu-c:3001', 9);

      const instanceUrl = await service.assign('room-1');

      expect(instanceUrl).toBe('http://sfu-b:3001');
    });

    it('ignores an instance key that expired between SCAN and MGET', async () => {
      await seedInstance('http://sfu-a:3001', 1);
      // MGET racing a TTL expiry after SCAN already saw the key returns null
      // for it - simulate that race directly rather than relying on timing.
      jest.spyOn(redis, 'mget').mockResolvedValueOnce([null]);

      const instanceUrl = await service.assign('room-1');

      expect(instanceUrl).toBe('http://localhost:3001');
    });
  });

  describe('get', () => {
    it('returns undefined when no session has been assigned', async () => {
      expect(await service.get('room-1')).toBeUndefined();
    });

    it('returns the pinned instance url once assigned', async () => {
      await service.assign('room-1');

      expect(await service.get('room-1')).toBe('http://localhost:3001');
    });
  });

  describe('touch', () => {
    it('refreshes the session TTL', async () => {
      await service.assign('room-1');
      const expireSpy = jest.spyOn(redis, 'expire');

      await service.touch('room-1');

      expect(expireSpy).toHaveBeenCalledWith('session:room-1', 30);
    });

    it('debounces a burst of touches into a single EXPIRE call', async () => {
      await service.assign('room-1');
      const expireSpy = jest.spyOn(redis, 'expire');

      await service.touch('room-1');
      await service.touch('room-1');
      await service.touch('room-1');

      expect(expireSpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes again once the debounce window has passed', async () => {
      jest.useFakeTimers();

      try {
        await service.assign('room-1');
        const expireSpy = jest.spyOn(redis, 'expire');

        await service.touch('room-1');
        jest.advanceTimersByTime(10_001);
        await service.touch('room-1');

        expect(expireSpy).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('debounces separately per room', async () => {
      await service.assign('room-1');
      await service.assign('room-2');
      const expireSpy = jest.spyOn(redis, 'expire');

      await service.touch('room-1');
      await service.touch('room-2');

      expect(expireSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate', () => {
    it('deletes the session key immediately', async () => {
      await service.assign('room-1');

      await service.invalidate('room-1');

      expect(await service.get('room-1')).toBeUndefined();
    });

    it('is a no-op when no session exists', async () => {
      await expect(service.invalidate('missing-room')).resolves.not.toThrow();
    });

    it('lets a following touch refresh again without being debounced by the stale timer', async () => {
      await service.assign('room-1');
      await service.touch('room-1');
      await service.invalidate('room-1');
      await service.assign('room-1');
      const expireSpy = jest.spyOn(redis, 'expire');

      await service.touch('room-1');

      expect(expireSpy).toHaveBeenCalledTimes(1);
    });
  });
});
