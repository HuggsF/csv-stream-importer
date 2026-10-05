import type {
  ImportJobStatusOutput,
  ProcessImportJobInput,
} from '@application/dtos/import-job.dto';
import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import type { ProcessImportJobUseCase } from '@application/use-cases/process-import-job.use-case';
import { fail, ok } from '@domain/shared/result';
import { InProcessImportJobQueue } from '@infrastructure/queue/in-process-import-job-queue';
import { createLoggerMock } from '../../support/fakes';

type Execute = ProcessImportJobUseCase['execute'];

const status = (jobId: string): ImportJobStatusOutput => ({
  jobId,
  fileName: `${jobId}.csv`,
  status: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
});

/** A processor whose jobs only finish when the test releases them. */
const controllableProcessor = (): {
  execute: jest.Mock<ReturnType<Execute>, Parameters<Execute>>;
  started: ProcessImportJobInput[];
  release: (jobId: string) => void;
} => {
  const started: ProcessImportJobInput[] = [];
  const releases = new Map<string, () => void>();
  const execute = jest.fn<ReturnType<Execute>, Parameters<Execute>>(async (input) => {
    started.push(input);
    await new Promise<void>((resolve) => {
      releases.set(input.jobId, resolve);
      if (input.signal?.aborted === true) {
        resolve();
      }
      input.signal?.addEventListener('abort', () => {
        resolve();
      });
    });
    return ok(status(input.jobId));
  });
  return { execute, started, release: (jobId) => releases.get(jobId)?.() };
};

const command = (jobId: string): { jobId: string; filePath: string; batchSize: number } => ({
  jobId,
  filePath: `/tmp/${jobId}.csv`,
  batchSize: 1000,
});

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('InProcessImportJobQueue', () => {
  it('runs at most `concurrency` jobs at a time, in FIFO order', async () => {
    const processor = controllableProcessor();
    const queue = new InProcessImportJobQueue(
      { execute: processor.execute },
      { concurrency: 1, maxPending: 5 },
      createLoggerMock(),
    );

    expect(queue.enqueue(command('a'))).toBe('accepted');
    expect(queue.enqueue(command('b'))).toBe('accepted');
    await flush();

    expect(processor.started.map(({ jobId }) => jobId)).toEqual(['a']);
    expect(queue.stats).toEqual({ running: 1, pending: 1 });

    processor.release('a');
    await flush();
    await flush();
    expect(processor.started.map(({ jobId }) => jobId)).toEqual(['a', 'b']);
  });

  it('answers queue-full when the backlog is at capacity', () => {
    const processor = controllableProcessor();
    const queue = new InProcessImportJobQueue(
      { execute: processor.execute },
      { concurrency: 1, maxPending: 1 },
      createLoggerMock(),
    );

    expect(queue.enqueue(command('a'))).toBe('accepted');
    expect(queue.enqueue(command('b'))).toBe('accepted');
    expect(queue.enqueue(command('c'))).toBe('queue-full');
  });

  it('aborts running jobs, cancels queued ones and refuses new ones on shutdown', async () => {
    const processor = controllableProcessor();
    const queue = new InProcessImportJobQueue(
      { execute: processor.execute },
      { concurrency: 1, maxPending: 5 },
      createLoggerMock(),
    );
    queue.enqueue(command('running'));
    queue.enqueue(command('queued'));
    await flush();

    await queue.shutdown();

    const [running, queued] = processor.started;
    expect(running?.signal?.aborted).toBe(true);
    expect(queued?.jobId).toBe('queued');
    expect(queued?.signal?.aborted).toBe(true);
    expect(queue.enqueue(command('late'))).toBe('shutting-down');
  });

  it('logs jobs that fail or crash without breaking the queue', async () => {
    const logger = createLoggerMock();
    const execute = jest
      .fn<ReturnType<Execute>, Parameters<Execute>>()
      .mockResolvedValueOnce(fail(new ImportJobNotFoundError('x')))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(ok(status('z')));
    const queue = new InProcessImportJobQueue(
      { execute },
      { concurrency: 1, maxPending: 5 },
      logger,
    );

    queue.enqueue(command('x'));
    queue.enqueue(command('y'));
    queue.enqueue(command('z'));
    await queue.shutdown();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'x' }),
      'Import job could not run',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'y' }),
      'Import job crashed',
    );
  });
});
