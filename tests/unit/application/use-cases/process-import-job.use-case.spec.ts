import type { ImportStudentsOutput } from '@application/dtos/import-students.dto';
import { ImportFailedError } from '@application/errors/import-failed.error';
import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { ImportStudentsUseCase } from '@application/use-cases/import-students.use-case';
import { ProcessImportJobUseCase } from '@application/use-cases/process-import-job.use-case';
import { ImportJob } from '@domain/entities/import-job.entity';
import { InvalidImportJobTransitionError } from '@domain/errors/invalid-import-job-transition.error';
import { fail, ok } from '@domain/shared/result';
import {
  FakeFileStorage,
  FixedClock,
  InMemoryImportJobRepository,
  createLoggerMock,
} from '../../../support/fakes';

const output: ImportStudentsOutput = {
  totalProcessed: 3,
  totalImported: 2,
  totalErrors: 1,
  errors: [
    { lineNumber: 3, field: 'score', value: '-1', message: 'Score must be between 0 and 100' },
  ],
  durationMs: 12,
  peakMemoryMB: 40.5,
  rowsPerSecond: 250,
  errorReportPath: 'output/errors.csv',
  aborted: false,
};

type ImportStudents = Pick<ImportStudentsUseCase, 'execute'>;

const setup = async (
  importStudents: ImportStudents,
): Promise<{
  useCase: ProcessImportJobUseCase;
  repository: InMemoryImportJobRepository;
  fileStorage: FakeFileStorage;
  clock: FixedClock;
}> => {
  const repository = new InMemoryImportJobRepository();
  const clock = new FixedClock();
  await repository.save(
    ImportJob.create({ id: 'job-1', fileName: 'students.csv', createdAt: clock.now() }),
  );
  const fileStorage = new FakeFileStorage();
  const useCase = new ProcessImportJobUseCase(
    repository,
    importStudents,
    fileStorage,
    clock,
    createLoggerMock(),
  );
  return { useCase, repository, fileStorage, clock };
};

const command = { jobId: 'job-1', filePath: '/tmp/uploads/job-1.csv', batchSize: 500 };

describe('ProcessImportJobUseCase', () => {
  it('runs the import, completes the job and removes the upload', async () => {
    const execute = jest
      .fn<ReturnType<ImportStudents['execute']>, Parameters<ImportStudents['execute']>>()
      .mockResolvedValue(ok(output));
    const { useCase, repository, fileStorage } = await setup({ execute });
    const controller = new AbortController();

    const result = await useCase.execute({ ...command, signal: controller.signal });

    expect(execute).toHaveBeenCalledWith({
      filePath: '/tmp/uploads/job-1.csv',
      batchSize: 500,
      signal: controller.signal,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
      expect(result.data.result).toEqual(output);
      expect(result.data.startedAt).toBe('2026-01-01T12:00:00.000Z');
      expect(result.data.error).toBeNull();
    }
    expect(repository.jobs.get('job-1')?.status).toBe('completed');
    expect(fileStorage.removed).toEqual(['/tmp/uploads/job-1.csv']);
  });

  it('marks the job as failed when the import fails', async () => {
    const failure = new ImportFailedError('ECONNREFUSED', {
      totalProcessed: 10,
      totalImported: 0,
      totalErrors: 0,
    });
    const { useCase, repository, fileStorage } = await setup({
      execute: jest.fn().mockResolvedValue(fail(failure)),
    });

    const result = await useCase.execute(command);

    expect(result.success && result.data.status).toBe('failed');
    expect(repository.jobs.get('job-1')?.failureReason).toBe(
      'Import failed after 10 rows: ECONNREFUSED',
    );
    expect(fileStorage.removed).toHaveLength(1);
  });

  it('marks the job as failed when the report violates the job invariants', async () => {
    const { useCase } = await setup({
      execute: jest.fn().mockResolvedValue(ok({ ...output, totalImported: 5 })),
    });

    const result = await useCase.execute(command);

    expect(result.success && result.data.error).toBe(
      'Import report is inconsistent: imported + errors cannot exceed the processed rows',
    );
  });

  it('fails a job cancelled before it started without running the import', async () => {
    const execute = jest.fn();
    const { useCase, repository, fileStorage } = await setup({ execute });
    const controller = new AbortController();
    controller.abort();

    const result = await useCase.execute({ ...command, signal: controller.signal });

    expect(result.success && result.data.status).toBe('failed');
    expect(repository.jobs.get('job-1')?.failureReason).toBe('Import cancelled before it started');
    expect(execute).not.toHaveBeenCalled();
    expect(fileStorage.removed).toEqual(['/tmp/uploads/job-1.csv']);
  });

  it('fails with ImportJobNotFoundError for an unknown job but still removes the upload', async () => {
    const execute = jest.fn();
    const { useCase, fileStorage } = await setup({ execute });

    const result = await useCase.execute({ ...command, jobId: 'missing' });

    expect(!result.success && result.error).toBeInstanceOf(ImportJobNotFoundError);
    expect(execute).not.toHaveBeenCalled();
    expect(fileStorage.removed).toEqual(['/tmp/uploads/job-1.csv']);
  });

  it('refuses to process a job twice', async () => {
    const { useCase, repository } = await setup({
      execute: jest.fn().mockResolvedValue(ok(output)),
    });
    await useCase.execute(command);

    const result = await useCase.execute(command);

    expect(!result.success && result.error).toBeInstanceOf(InvalidImportJobTransitionError);
    expect(repository.jobs.get('job-1')?.status).toBe('completed');
  });

  it('wraps unexpected exceptions into a Result', async () => {
    const { useCase, repository } = await setup({ execute: jest.fn() });
    jest.spyOn(repository, 'findById').mockRejectedValue(new Error('boom'));

    const result = await useCase.execute(command);

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(!result.success && result.error.message).toBe(
      'Import job job-1 failed unexpectedly: boom',
    );
  });

  it('only logs when the upload cannot be removed', async () => {
    const { useCase, fileStorage } = await setup({
      execute: jest.fn().mockResolvedValue(ok(output)),
    });
    jest.spyOn(fileStorage, 'remove').mockRejectedValue(new Error('EBUSY'));

    const result = await useCase.execute(command);

    expect(result.success).toBe(true);
  });
});
