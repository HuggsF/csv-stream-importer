import { toImportJobStatusOutput, toImportReport } from '@application/services/import-job.mapper';
import { ImportJob } from '@domain/entities/import-job.entity';

describe('import job mapper', () => {
  it('maps a completed job, copying the error sample', () => {
    const job = ImportJob.create({
      id: 'job-9',
      fileName: 'big.csv',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    job.start(new Date('2026-03-01T00:00:01.000Z'));
    const errors = [{ lineNumber: 2, field: 'email', value: 'x', message: 'invalid' }];
    job.complete(
      toImportReport({
        totalProcessed: 1,
        totalImported: 0,
        totalErrors: 1,
        errors,
        durationMs: 5,
        peakMemoryMB: 30,
        rowsPerSecond: 200,
        errorReportPath: 'output/errors.csv',
        aborted: false,
      }),
      new Date('2026-03-01T00:00:02.000Z'),
    );

    const dto = toImportJobStatusOutput(job);

    expect(dto.status).toBe('completed');
    expect(dto.finishedAt).toBe('2026-03-01T00:00:02.000Z');
    expect(dto.result?.errors).toEqual(errors);
    expect(dto.result?.errors).not.toBe(job.report?.errors);
  });

  it('maps a failed job with its reason', () => {
    const job = ImportJob.create({ id: 'job-1', fileName: 'a.csv', createdAt: new Date(0) });
    job.markFailed('shutting down', new Date(1000));

    const dto = toImportJobStatusOutput(job);

    expect(dto).toMatchObject({
      status: 'failed',
      startedAt: null,
      finishedAt: '1970-01-01T00:00:01.000Z',
      result: null,
      error: 'shutting down',
    });
  });
});
