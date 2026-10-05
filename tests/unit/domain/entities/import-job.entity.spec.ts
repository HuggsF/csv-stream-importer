import { ImportJob } from '@domain/entities/import-job.entity';
import type { ImportReport } from '@domain/entities/import-job.entity';
import { InvalidImportJobTransitionError } from '@domain/errors/invalid-import-job-transition.error';
import { InvalidImportReportError } from '@domain/errors/invalid-import-report.error';

const createdAt = new Date('2026-01-10T10:00:00.000Z');
const startedAt = new Date('2026-01-10T10:00:01.000Z');
const finishedAt = new Date('2026-01-10T10:00:09.000Z');

const report = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  totalProcessed: 10,
  totalImported: 8,
  totalErrors: 2,
  errors: [],
  durationMs: 8000,
  peakMemoryMB: 48.2,
  rowsPerSecond: 1.25,
  errorReportPath: 'output/errors.csv',
  aborted: false,
  ...overrides,
});

const newJob = (): ImportJob =>
  ImportJob.create({ id: 'job-1', fileName: 'students.csv', createdAt });

describe('ImportJob', () => {
  it('starts as pending', () => {
    const job = newJob();

    expect(job.status).toBe('pending');
    expect(job.id).toBe('job-1');
    expect(job.fileName).toBe('students.csv');
    expect(job.createdAt).toBe(createdAt);
    expect(job.startedAt).toBeNull();
    expect(job.finishedAt).toBeNull();
    expect(job.report).toBeNull();
    expect(job.failureReason).toBeNull();
    expect(job.isFinished).toBe(false);
  });

  it('follows pending → processing → completed', () => {
    const job = newJob();

    expect(job.start(startedAt).success).toBe(true);
    expect(job.status).toBe('processing');
    expect(job.startedAt).toBe(startedAt);

    expect(job.complete(report(), finishedAt).success).toBe(true);
    expect(job.status).toBe('completed');
    expect(job.report?.totalImported).toBe(8);
    expect(job.finishedAt).toBe(finishedAt);
    expect(job.isFinished).toBe(true);
  });

  it('can fail while processing', () => {
    const job = newJob();
    job.start(startedAt);

    expect(job.markFailed('database unavailable', finishedAt).success).toBe(true);
    expect(job.status).toBe('failed');
    expect(job.failureReason).toBe('database unavailable');
    expect(job.isFinished).toBe(true);
  });

  it('can fail before it starts (e.g. shutdown while queued)', () => {
    const job = newJob();

    expect(job.markFailed('shutting down', finishedAt).success).toBe(true);
    expect(job.status).toBe('failed');
  });

  it('cannot start twice', () => {
    const job = newJob();
    job.start(startedAt);

    const result = job.start(startedAt);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidImportJobTransitionError);
      expect(result.error.message).toBe(
        'Import job job-1 cannot move from "processing" to "processing"',
      );
    }
  });

  it('cannot complete a job that never started', () => {
    const result = newJob().complete(report(), finishedAt);

    expect(!result.success && result.error).toBeInstanceOf(InvalidImportJobTransitionError);
  });

  it('cannot fail a finished job', () => {
    const job = newJob();
    job.start(startedAt);
    job.complete(report(), finishedAt);

    const result = job.markFailed('late failure', finishedAt);

    expect(result.success).toBe(false);
    expect(job.status).toBe('completed');
  });

  it.each([
    [{ totalProcessed: -1 }, 'row counts must be non-negative integers'],
    [{ totalImported: 1.5 }, 'row counts must be non-negative integers'],
    [{ totalImported: 9, totalErrors: 2 }, 'imported + errors cannot exceed the processed rows'],
  ])('rejects an inconsistent report %p', (overrides, reason) => {
    const job = newJob();
    job.start(startedAt);

    const result = job.complete(report(overrides), finishedAt);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidImportReportError);
      expect(result.error.message).toBe(`Import report is inconsistent: ${reason}`);
    }
    expect(job.status).toBe('processing');
  });
});
