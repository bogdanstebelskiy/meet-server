import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as os from 'node:os';
import { createWorker } from 'mediasoup';
import type { Worker } from 'mediasoup/types';
import { workerSettings } from './config';

@Injectable()
export class SfuService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SfuService.name);
  private workers: Worker[] = [];
  private routersPerWorker = new Map<Worker, number>();

  async onModuleInit() {
    const numWorkers = os.cpus().length;

    for (let idx = 0; idx < numWorkers; ++idx) {
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
      // close() only notifies the process, it doesn't wait for exit.
      worker.close();
      process.kill(worker.pid);
    });
  }

  getWorker(): Worker {
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

    return chosen;
  }

  trackRouterCreated(worker: Worker): void {
    this.routersPerWorker.set(
      worker,
      (this.routersPerWorker.get(worker) ?? 0) + 1,
    );
  }

  trackRouterClosed(worker: Worker): void {
    this.routersPerWorker.set(
      worker,
      Math.max(0, (this.routersPerWorker.get(worker) ?? 1) - 1),
    );
  }
}
