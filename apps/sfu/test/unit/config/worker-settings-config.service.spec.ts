import { ConfigService } from '@nestjs/config';
import * as os from 'node:os';
import { WorkerSettingsConfigService } from '../../../src/config/worker-settings-config.service';

jest.mock('node:os');

describe('WorkerSettingsConfigService', () => {
  let configService: { get: jest.Mock };
  let service: WorkerSettingsConfigService;

  beforeEach(() => {
    configService = { get: jest.fn() };
    service = new WorkerSettingsConfigService(configService as unknown as ConfigService);
  });

  describe('numWorkers', () => {
    it('falls back to the host CPU core count when unset', () => {
      configService.get.mockReturnValue(undefined);
      (os.cpus as jest.Mock).mockReturnValue([{}, {}, {}, {}]);

      expect(service.numWorkers).toBe(4);
    });

    it('uses SFU_WORKER_POOL_SIZE when set, ignoring the host core count', () => {
      configService.get.mockReturnValue('2');
      (os.cpus as jest.Mock).mockReturnValue([{}, {}, {}, {}]);

      expect(service.numWorkers).toBe(2);
    });
  });
});
