import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { GetImportJobStatusUseCase } from '@application/use-cases/get-import-job-status.use-case';
import { ImportJob } from '@domain/entities/import-job.entity';
import { InMemoryImportJobRepository } from '../../../support/fakes';

describe('GetImportJobStatusUseCase', () => {
  it('returns the job status as a DTO', async () => {
    const repository = new InMemoryImportJobRepository();
    const job = ImportJob.create({
      id: 'job-1',
      fileName: 'students.csv',
      createdAt: new Date('2026-02-01T08:00:00.000Z'),
    });
    job.start(new Date('2026-02-01T08:00:01.000Z'));
    await repository.save(job);

    const result = await new GetImportJobStatusUseCase(repository).execute({ jobId: 'job-1' });

    expect(result).toEqual({
      success: true,
      data: {
        jobId: 'job-1',
        fileName: 'students.csv',
        status: 'processing',
        createdAt: '2026-02-01T08:00:00.000Z',
        startedAt: '2026-02-01T08:00:01.000Z',
        finishedAt: null,
        result: null,
        error: null,
      },
    });
  });

  it('fails with ImportJobNotFoundError for an unknown id', async () => {
    const useCase = new GetImportJobStatusUseCase(new InMemoryImportJobRepository());

    const result = await useCase.execute({ jobId: 'nope' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ImportJobNotFoundError);
      expect(result.error.code).toBe('IMPORT_JOB_NOT_FOUND');
      expect(result.error.message).toBe('Import job nope was not found');
    }
  });

  it('wraps repository failures into UnexpectedError', async () => {
    const repository = new InMemoryImportJobRepository();
    jest.spyOn(repository, 'findById').mockRejectedValue('timeout');

    const result = await new GetImportJobStatusUseCase(repository).execute({ jobId: 'job-1' });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(!result.success && result.error.message).toBe(
      'Loading the import job failed unexpectedly: timeout',
    );
  });
});
