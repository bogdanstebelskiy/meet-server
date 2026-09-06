import { Test, TestingModule } from '@nestjs/testing';
import { createWorker } from 'mediasoup';
import { WorkerPoolService } from '../../../src/workers/worker-pool.service';
import { WorkerSettingsConfigService } from '../../../src/config/worker-settings-config.service';

jest.mock('mediasoup');

describe('WorkerPoolService', () => {
  let service: WorkerPoolService;
  let nextPid = 1000;

  const createFakeWorker = () => ({
    pid: nextPid++,
    on: jest.fn(),
    close: jest.fn(),
  });

  beforeEach(async () => {
    nextPid = 1000;
    (createWorker as jest.Mock).mockImplementation(() =>
      Promise.resolve(createFakeWorker()),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerPoolService,
        {
          provide: WorkerSettingsConfigService,
          useValue: { settings: {}, numWorkers: 3 },
        },
      ],
    }).compile();

    service = module.get<WorkerPoolService>(WorkerPoolService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('spawns the configured number of workers on init', async () => {
    await service.onModuleInit();

    expect(createWorker).toHaveBeenCalledTimes(3);
  });

  it('reserveWorker throws before onModuleInit has run, instead of returning undefined', () => {
    expect(() => service.reserveWorker()).toThrow(
      /no mediasoup workers available/i,
    );
  });

  it('reserveWorker picks the worker with the fewest routers, not blind round-robin', async () => {
    await service.onModuleInit();

    const first = service.reserveWorker();
    service.reserveWorker();
    service.trackRouterClosed(first);

    const third = service.reserveWorker();
    expect(third).toBe(first);
  });

  it('reserveWorker spreads a burst of back-to-back calls across every worker, not onto one', async () => {
    await service.onModuleInit();

    // No intervening await between calls - this is exactly what a burst of
    // concurrent room-creation calls looks like before any createRouter
    // resolves, since JS runs each synchronous call to completion first.
    const first = service.reserveWorker();
    const second = service.reserveWorker();
    const third = service.reserveWorker();

    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('trackRouterClosed never drops a worker load below zero', async () => {
    await service.onModuleInit();
    const worker = service.reserveWorker();

    service.trackRouterClosed(worker);
    service.trackRouterClosed(worker);

    const picks = [
      service.reserveWorker(),
      service.reserveWorker(),
      service.reserveWorker(),
    ];
    expect(new Set(picks).size).toBe(3);
  });

  it('exits the process shortly after a worker dies', async () => {
    jest.useFakeTimers();
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    await service.onModuleInit();
    const worker = service.reserveWorker() as unknown as { on: jest.Mock };
    const diedHandler = worker.on.mock.calls.find(
      ([event]) => event === 'died',
    )?.[1];

    expect(diedHandler).toBeDefined();
    diedHandler();
    jest.advanceTimersByTime(2000);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('closes every worker and force-kills its OS process on module destroy', async () => {
    const killSpy = jest.spyOn(process, 'kill').mockReturnValue(true);

    await service.onModuleInit();
    const worker = service.reserveWorker() as unknown as {
      pid: number;
      close: jest.Mock;
    };

    service.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(worker.pid);
  });
});
