import { InvalidImportJobTransitionError } from '@domain/errors/invalid-import-job-transition.error';
import { InvalidImportReportError } from '@domain/errors/invalid-import-report.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type RowError = {
  readonly lineNumber: number;
  readonly field: string;
  readonly value: string;
  readonly message: string;
};

/** Outcome of an import run. Counts are rows; `errors` is a bounded sample (full list lives in the error report file). */
export type ImportReport = {
  readonly totalProcessed: number;
  readonly totalImported: number;
  readonly totalErrors: number;
  readonly errors: readonly RowError[];
  readonly durationMs: number;
  readonly peakMemoryMB: number;
  readonly rowsPerSecond: number;
  readonly errorReportPath: string | null;
  readonly aborted: boolean;
};

export type CreateImportJobProps = {
  readonly id: string;
  readonly fileName: string;
  readonly createdAt: Date;
};

/** Tracks the lifecycle of an asynchronous (HTTP-triggered) import: pending → processing → completed | failed. */
export class ImportJob {
  private _status: ImportJobStatus = 'pending';
  private _startedAt: Date | null = null;
  private _finishedAt: Date | null = null;
  private _report: ImportReport | null = null;
  private _failureReason: string | null = null;

  private constructor(
    readonly id: string,
    readonly fileName: string,
    readonly createdAt: Date,
  ) {}

  static create(props: CreateImportJobProps): ImportJob {
    return new ImportJob(props.id, props.fileName, props.createdAt);
  }

  get status(): ImportJobStatus {
    return this._status;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get finishedAt(): Date | null {
    return this._finishedAt;
  }

  get report(): ImportReport | null {
    return this._report;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get isFinished(): boolean {
    return this._status === 'completed' || this._status === 'failed';
  }

  start(at: Date): Result<void, InvalidImportJobTransitionError> {
    if (this._status !== 'pending') {
      return fail(new InvalidImportJobTransitionError(this.id, this._status, 'processing'));
    }
    this._status = 'processing';
    this._startedAt = at;
    return ok(undefined);
  }

  complete(
    report: ImportReport,
    at: Date,
  ): Result<void, InvalidImportJobTransitionError | InvalidImportReportError> {
    if (this._status !== 'processing') {
      return fail(new InvalidImportJobTransitionError(this.id, this._status, 'completed'));
    }
    const counts = [report.totalProcessed, report.totalImported, report.totalErrors];
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
      return fail(new InvalidImportReportError('row counts must be non-negative integers'));
    }
    if (report.totalImported + report.totalErrors > report.totalProcessed) {
      return fail(
        new InvalidImportReportError('imported + errors cannot exceed the processed rows'),
      );
    }
    this._status = 'completed';
    this._report = report;
    this._finishedAt = at;
    return ok(undefined);
  }

  markFailed(reason: string, at: Date): Result<void, InvalidImportJobTransitionError> {
    if (this.isFinished) {
      return fail(new InvalidImportJobTransitionError(this.id, this._status, 'failed'));
    }
    this._status = 'failed';
    this._failureReason = reason;
    this._finishedAt = at;
    return ok(undefined);
  }
}
