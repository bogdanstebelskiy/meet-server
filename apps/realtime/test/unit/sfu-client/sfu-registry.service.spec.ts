import { HttpException } from '@nestjs/common';
import { SfuRegistryService } from '../../../src/sfu-client/sfu-registry.service';
import { SfuConfigService } from '../../../src/config/sfu-config.service';
import { SfuClientService } from '../../../src/sfu-client/sfu-client.service';

describe('SfuRegistryService', () => {
  let service: SfuRegistryService;
  let sfuConfig: { serviceUrls: string[] };
  let sfuClient: { getStats: jest.Mock };

  beforeEach(() => {
    sfuConfig = { serviceUrls: ['http://sfu-1', 'http://sfu-2'] };
    sfuClient = { getStats: jest.fn() };

    service = new SfuRegistryService(
      sfuConfig as unknown as SfuConfigService,
      sfuClient as unknown as SfuClientService,
    );
  });

  it('picks the node reporting the fewest rooms', async () => {
    sfuClient.getStats.mockImplementation((nodeUrl: string) => {
      if (nodeUrl === 'http://sfu-1') {
        return Promise.resolve({ roomCount: 5 });
      }
      return Promise.resolve({ roomCount: 2 });
    });

    const picked = await service.pickLeastLoaded();

    expect(picked).toBe('http://sfu-2');
  });

  it('ignores a node whose stats call fails and picks among the reachable ones', async () => {
    sfuClient.getStats.mockImplementation((nodeUrl: string) => {
      if (nodeUrl === 'http://sfu-1') {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve({ roomCount: 7 });
    });

    const picked = await service.pickLeastLoaded();

    expect(picked).toBe('http://sfu-2');
  });

  it('throws a 503 when every configured node is unreachable', async () => {
    sfuClient.getStats.mockRejectedValue(new Error('connection refused'));

    await expect(service.pickLeastLoaded()).rejects.toThrow(HttpException);
  });
});
