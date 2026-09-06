import { ConfigService } from '@nestjs/config';
import { SfuConfigService } from '../../../src/config/sfu-config.service';

describe('SfuConfigService', () => {
  let configService: { get: jest.Mock };
  let service: SfuConfigService;

  beforeEach(() => {
    configService = { get: jest.fn() };
    service = new SfuConfigService(configService as unknown as ConfigService);
  });

  describe('serviceUrls', () => {
    it('falls back to a single localhost url when unset', () => {
      configService.get.mockImplementation(
        (_key: string, fallback: string) => fallback,
      );

      expect(service.serviceUrls).toEqual(['http://localhost:3001']);
    });

    it('splits a comma-separated list into individual urls', () => {
      configService.get.mockReturnValue('http://sfu-1:3001,http://sfu-2:3001');

      expect(service.serviceUrls).toEqual([
        'http://sfu-1:3001',
        'http://sfu-2:3001',
      ]);
    });

    it('trims whitespace and drops empty entries', () => {
      configService.get.mockReturnValue(
        ' http://sfu-1:3001 , , http://sfu-2:3001,',
      );

      expect(service.serviceUrls).toEqual([
        'http://sfu-1:3001',
        'http://sfu-2:3001',
      ]);
    });
  });
});
