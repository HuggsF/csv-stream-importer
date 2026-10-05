import { ImportJobRejectedError } from '@application/errors/import-job-rejected.error';
import { InvalidImportOptionsError } from '@application/errors/invalid-import-options.error';
import type {
  EnqueueOutcome,
  ImportJobCommand,
  ImportJobQueue,
} from '@application/interfaces/import-job-queue';
import { StartImportJobUseCase } from '@application/use-cases/start-import-job.use-case';
import { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import {
  FakeFileStorage,
  FixedClock,
  InMemoryImportJobRepository,
  SequentialIdGenerator,
  createLoggerMock,
} from '../../../support/fakes';
import type { LoggerMock } from '../../../support/fakes';

class RecordingQueue implements ImportJobQueue {
  readonly commands: ImportJobCommand[] = [];

  constructor(private readonly outcome: EnqueueOutcome = 'accepted') {}

  enqueue(command: ImportJobCommand): EnqueueOutcome {
    this.commands.push(command);
    return this.outcome;
  }
}

type Sut = {
  useCase: StartImportJobUseCase;
  queue: RecordingQueue;
  repository: InMemoryImportJobRepository;
  fileStorage: FakeFileStorage;
  logger: LoggerMock;
};

const makeSut = (
  queue = new RecordingQueue(),
  repository = new InMemoryImportJobRepository(),
  fileStorage = new FakeFileStorage(),
): Sut => {
  const logger = createLoggerMock();
  return {
    useCase: new StartImportJobUseCase(
      repository,
      queue,
      fileStorage,
      new SequentialIdGenerator(),
      new FixedClock(),
      logger,
    ),
    queue,
    repository,
    fileStorage,
    logger,
  };
};

const input = { filePath: '/tmp/uploads/abc.csv', originalFileName: 'students.csv' };

describe('StartImportJobUseCase', () => {
  it('saves a pending job and enqueues it with the default batch size', async () => {
    const { useCase, queue, repository, fileStorage } = makeSut();

    const result = await useCase.execute(input);

    expect(result).toEqual({ success: true, data: { jobId: 'id-1' } });
    expect(queue.commands).toEqual([
      { jobId: 'id-1', filePath: '/tmp/uploads/abc.csv', batchSize: 1000 },
    ]);
    const job = repository.jobs.get('id-1');
    expect(job?.status).toBe('pending');
    expect(job?.fileName).toBe('students.csv');
    expect(job?.createdAt.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(fileStorage.removed).toEqual([]);
  });

  it('forwards a custom batch size', async () => {
    const { useCase, queue } = makeSut();

    await useCase.execute({ ...input, batchSize: 250 });

    expect(queue.commands[0]?.batchSize).toBe(250);
  });

  it('rejects an invalid batch size and discards the upload', async () => {
    const { useCase, repository, fileStorage } = makeSut();

    const result = await useCase.execute({ ...input, batchSize: 0 });

    expect(!result.success && result.error).toBeInstanceOf(InvalidImportOptionsError);
    expect(repository.jobs.size).toBe(0);
    expect(fileStorage.removed).toEqual(['/tmp/uploads/abc.csv']);
  });

  it('rejects a non-csv file and discards the upload', async () => {
    const { useCase, repository, fileStorage } = makeSut();

    const result = await useCase.execute({ ...input, filePath: '/tmp/uploads/abc.txt' });

    expect(!result.success && result.error).toBeInstanceOf(InvalidFilePathError);
    expect(repository.jobs.size).toBe(0);
    expect(fileStorage.removed).toEqual(['/tmp/uploads/abc.txt']);
  });

  it.each(['queue-full', 'shutting-down'] as const)(
    'marks the job as failed when the queue answers %s',
    async (outcome) => {
      const { useCase, repository, fileStorage } = makeSut(new RecordingQueue(outcome));

      const result = await useCase.execute(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ImportJobRejectedError);
        expect((result.error as ImportJobRejectedError).reason).toBe(outcome);
      }
      expect(repository.jobs.get('id-1')?.status).toBe('failed');
      expect(fileStorage.removed).toEqual(['/tmp/uploads/abc.csv']);
    },
  );

  it('returns a rejection instead of throwing when persistence fails', async () => {
    const repository = new InMemoryImportJobRepository();
    jest.spyOn(repository, 'save').mockRejectedValue(new Error('disk full'));
    const { useCase } = makeSut(new RecordingQueue(), repository);

    const result = await useCase.execute(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('The import job could not be scheduled');
      expect(result.error.cause).toEqual(new Error('disk full'));
    }
  });

  it('still answers when the rejected upload cannot be removed', async () => {
    const fileStorage = new FakeFileStorage();
    jest.spyOn(fileStorage, 'remove').mockRejectedValue(new Error('EPERM'));
    const { useCase, logger } = makeSut(new RecordingQueue('queue-full'), undefined, fileStorage);

    const result = await useCase.execute(input);

    expect(result.success).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/uploads/abc.csv' }),
      'Could not remove rejected upload',
    );
  });
});
