import { Test, TestingModule } from '@nestjs/testing';
import * as os from 'node:os';
import { createWorker } from 'mediasoup';
import { WorkerPoolService } from '../../../src/workers/worker-pool.service';

jest.mock('node:os');
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
    (os.cpus as jest.Mock).mockReturnValue([{}, {}, {}]);
    (createWorker as jest.Mock).mockImplementation(() =>
      Promise.resolve(createFakeWorker()),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkerPoolService],
    }).compile();

    service = module.get<WorkerPoolService>(WorkerPoolService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('spawns one worker per reported CPU core on init', async () => {
    await service.onModuleInit();

    expect(createWorker).toHaveBeenCalledTimes(3);
  });

  it('getWorker throws before onModuleInit has run, instead of returning undefined', () => {
    expect(() => service.getWorker()).toThrow(
      /no mediasoup workers available/i,
    );
  });

  it('getWorker picks the worker with the fewest routers, not blind round-robin', async () => {
    await service.onModuleInit();

    const first = service.getWorker();
    service.trackRouterCreated(first);
    service.trackRouterCreated(first);

    const second = service.getWorker();
    expect(second).not.toBe(first);

    service.trackRouterCreated(second);
    service.trackRouterCreated(second);

    const third = service.getWorker();
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it('trackRouterClosed never drops a worker load below zero', async () => {
    await service.onModuleInit();
    const worker = service.getWorker();

    service.trackRouterClosed(worker);
    service.trackRouterClosed(worker);
    service.trackRouterCreated(worker);

    const other = service.getWorker();
    expect(other).not.toBe(worker);
  });

  it('exits the process shortly after a worker dies', async () => {
    jest.useFakeTimers();
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    await service.onModuleInit();
    const worker = service.getWorker() as unknown as { on: jest.Mock };
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
    const worker = service.getWorker() as unknown as {
      pid: number;
      close: jest.Mock;
    };

    service.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(worker.pid);
  });
});
