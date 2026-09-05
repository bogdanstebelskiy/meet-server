import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as os from 'node:os';
import { createWorker } from 'mediasoup';
import type { Worker } from 'mediasoup/types';
import { WorkerSettingsConfigService } from '../config/worker-settings-config.service';

@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolService.name);
  private workers: Worker[] = [];
  private routersPerWorker = new Map<Worker, number>();

  constructor(
    private readonly workerSettingsConfig: WorkerSettingsConfigService,
  ) {}

  async onModuleInit() {
    const numWorkers = os.cpus().length;

    for (let idx = 0; idx < numWorkers; ++idx) {
      const workerSettings = this.workerSettingsConfig.settings;
      const worker = await createWorker(workerSettings);

      worker.on('died', () => {
        this.logger.error(`Worker ${worker.pid} died, exiting process...`);
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
      this.routersPerWorker.set(worker, 0);
    }

    this.logger.log(`Spawned ${numWorkers} mediasoup workers`);
  }

  onModuleDestroy() {
    this.workers.forEach((worker) => {
      try {
        // close() only notifies the process, it doesn't wait for exit.
        worker.close();
        process.kill(worker.pid);
      } catch {
        // Worker's OS process may have already exited; nothing left to clean up,
        // and one failure here must not stop the remaining workers from closing.
      }
    });
  }

  // Reserves the slot synchronously so a concurrent burst can't all read
  // the same pre-burst counts and pile onto one worker.
  reserveWorker(): Worker {
    if (this.workers.length === 0) {
      throw new Error(
        'No mediasoup workers available - onModuleInit has not run yet',
      );
    }

    let chosen = this.workers[0];
    let min = this.routersPerWorker.get(chosen)!;

    for (const worker of this.workers) {
      const count = this.routersPerWorker.get(worker)!;

      if (count < min) {
        min = count;
        chosen = worker;
      }
    }

    this.routersPerWorker.set(chosen, min + 1);

    return chosen;
  }

  trackRouterClosed(worker: Worker): void {
    const count = this.routersPerWorker.get(worker);

    if (count === undefined) {
      return;
    }

    this.routersPerWorker.set(worker, Math.max(0, count - 1));
  }
}
