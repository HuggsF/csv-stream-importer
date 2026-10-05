import type {
  EnqueueOutcome,
  ImportJobCommand,
  ImportJobQueue,
} from '@application/interfaces/import-job-queue';
import type { Logger } from '@application/interfaces/logger';
import type { ProcessImportJobUseCase } from '@application/use-cases/process-import-job.use-case';

export type ImportJobQueueOptions = {
  /** Imports running at the same time (each one holds DB connections and a file stream). */
  readonly concurrency: number;
  /** Jobs allowed to wait; beyond that `enqueue` answers `queue-full` (HTTP 503). */
  readonly maxPending: number;
};

type RunningJob = { readonly controller: AbortController; readonly done: Promise<void> };

/**
 * Minimal in-process work queue with bounded concurrency and bounded backlog.
 * On shutdown, running imports are aborted (they flush their current batch and stop) and
 * queued jobs are cancelled — nothing is left half-written.
 */
export class InProcessImportJobQueue implements ImportJobQueue {
  private readonly pending: ImportJobCommand[] = [];
  private readonly running = new Map<string, RunningJob>();
  private closed = false;

  constructor(
    private readonly processJob: Pick<ProcessImportJobUseCase, 'execute'>,
    private readonly options: ImportJobQueueOptions,
    private readonly logger: Logger,
  ) {}

  enqueue(command: ImportJobCommand): EnqueueOutcome {
    if (this.closed) {
      return 'shutting-down';
    }
    if (
      this.running.size >= this.options.concurrency &&
      this.pending.length >= this.options.maxPending
    ) {
      return 'queue-full';
    }
    this.pending.push(command);
    this.startNext();
    return 'accepted';
  }

  get stats(): { readonly running: number; readonly pending: number } {
    return { running: this.running.size, pending: this.pending.length };
  }

  /** Stops accepting jobs, cancels queued ones and waits for running ones to wind down. */
  async shutdown(): Promise<void> {
    this.closed = true;
    const cancelled = this.pending.splice(0, this.pending.length);
    const abortedSignal = AbortSignal.abort();

    for (const { controller } of this.running.values()) {
      controller.abort();
    }
    await Promise.allSettled([
      ...[...this.running.values()].map(({ done }) => done),
      ...cancelled.map((command) => this.run(command, abortedSignal)),
    ]);
  }

  private startNext(): void {
    while (!this.closed && this.running.size < this.options.concurrency) {
      const command = this.pending.shift();
      if (command === undefined) {
        return;
      }
      const controller = new AbortController();
      const done = this.run(command, controller.signal).finally(() => {
        this.running.delete(command.jobId);
        this.startNext();
      });
      this.running.set(command.jobId, { controller, done });
    }
  }

  private async run(command: ImportJobCommand, signal: AbortSignal): Promise<void> {
    try {
      const result = await this.processJob.execute({ ...command, signal });
      if (!result.success) {
        this.logger.error({ jobId: command.jobId, err: result.error }, 'Import job could not run');
      }
    } catch (error: unknown) {
      this.logger.error({ jobId: command.jobId, err: error }, 'Import job crashed');
    }
  }
}
