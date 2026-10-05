import type {
  ImportStudentsInput,
  ImportStudentsOutput,
  ValidationError,
} from '@application/dtos/import-students.dto';
import { ImportFailedError } from '@application/errors/import-failed.error';
import type { InvalidImportOptionsError } from '@application/errors/invalid-import-options.error';
import type { CsvStreamReader, RawStudentRow } from '@application/interfaces/csv-stream-reader';
import type { ErrorReport, ErrorReportWriter } from '@application/interfaces/error-report-writer';
import type { FileStorage } from '@application/interfaces/file-storage';
import type { IdGenerator } from '@application/interfaces/id-generator';
import type { Logger } from '@application/interfaces/logger';
import type { PerformanceMonitor } from '@application/interfaces/performance-monitor';
import { resolveBatchSize } from '@application/services/import-options';
import { Student } from '@domain/entities/student.entity';
import type { FieldValidationError } from '@domain/errors/domain.error';
import { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import type { StudentRepository } from '@domain/repositories/student.repository';
import { StudentUniquenessService } from '@domain/services/student-uniqueness.service';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { FilePath } from '@domain/value-objects/file-path.value-object';

/** Size of the `errors` sample returned to the caller; the error report file has them all. */
export const MAX_ERRORS_IN_RESULT = 100;
/** Log a progress line every N rows. */
export const PROGRESS_LOG_INTERVAL = 10_000;
/** Individual warnings for the first N rejected rows; afterwards only the report file grows. */
export const MAX_ROW_WARNINGS = 100;

export type ImportStudentsError =
  InvalidImportOptionsError | InvalidFilePathError | ImportFailedError;

type PendingStudent = { readonly student: Student; readonly lineNumber: number };

type ImportState = {
  processed: number;
  imported: number;
  rejected: number;
  peakMemoryMB: number;
  aborted: boolean;
  batch: PendingStudent[];
  sampleErrors: ValidationError[];
  report: ErrorReport | null;
};

/**
 * Streams a CSV file row by row, validates every row through the Domain, and bulk-inserts
 * valid students in batches. Memory stays bounded by `batchSize`, regardless of file size:
 *
 *   for await (row of csv)  ──► Student.create(row) ──► batch[] ──(full)──► bulkInsert(batch)
 *                                      └── invalid ──► error report (streamed to disk)
 *
 * While a batch is being inserted the loop is suspended, so the reader stops pulling from
 * disk and the file stream pauses — that is the backpressure.
 */
export class ImportStudentsUseCase {
  private readonly uniqueness = new StudentUniquenessService();

  constructor(
    private readonly studentRepository: StudentRepository,
    private readonly csvReader: CsvStreamReader,
    private readonly logger: Logger,
    private readonly errorReportWriter: ErrorReportWriter,
    private readonly fileStorage: FileStorage,
    private readonly idGenerator: IdGenerator,
    private readonly performanceMonitor: PerformanceMonitor,
  ) {}

  async execute(
    input: ImportStudentsInput,
  ): Promise<Result<ImportStudentsOutput, ImportStudentsError>> {
    const batchSize = resolveBatchSize(input.batchSize);
    if (!batchSize.success) {
      return batchSize;
    }
    const filePath = FilePath.create(input.filePath);
    if (!filePath.success) {
      return filePath;
    }

    const startedAt = this.performanceMonitor.nowMs();
    const state: ImportState = {
      processed: 0,
      imported: 0,
      rejected: 0,
      peakMemoryMB: this.performanceMonitor.memoryUsageMB(),
      aborted: false,
      batch: [],
      sampleErrors: [],
      report: null,
    };

    try {
      if (!(await this.fileStorage.isReadable(filePath.data.value))) {
        return fail(
          new InvalidFilePathError(input.filePath, 'File does not exist or is not readable'),
        );
      }
      this.logger.info(
        { filePath: filePath.data.value, batchSize: batchSize.data },
        'Import started',
      );

      for await (const row of this.csvReader.read(filePath.data.value)) {
        if (input.signal?.aborted === true) {
          state.aborted = true;
          break;
        }
        state.processed += 1;
        await this.processRow(row, state);

        if (state.batch.length >= batchSize.data) {
          await this.flushBatch(state);
        }
        if (state.processed % PROGRESS_LOG_INTERVAL === 0) {
          this.logProgress(state, startedAt);
        }
      }
      await this.flushBatch(state);

      const output = this.buildOutput(state, startedAt);
      this.logger.info(
        {
          totalProcessed: output.totalProcessed,
          totalImported: output.totalImported,
          totalErrors: output.totalErrors,
          durationMs: output.durationMs,
          rowsPerSecond: output.rowsPerSecond,
          peakMemoryMB: output.peakMemoryMB,
          errorReportPath: output.errorReportPath,
        },
        state.aborted ? 'Import aborted' : 'Import completed',
      );
      return ok(output);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { err: error, totalProcessed: state.processed, totalImported: state.imported },
        'Import failed',
      );
      return fail(
        new ImportFailedError(
          reason,
          {
            totalProcessed: state.processed,
            totalImported: state.imported,
            totalErrors: state.rejected,
          },
          error,
        ),
      );
    } finally {
      await this.closeReport(state);
    }
  }

  private async processRow(row: RawStudentRow, state: ImportState): Promise<void> {
    const result = Student.create({
      id: this.idGenerator.generate(),
      name: row.name ?? '',
      email: row.email ?? '',
      enrollmentDate: row.enrollmentDate ?? '',
      courseId: row.courseId ?? '',
      score: row.score ?? '',
    });

    if (result.success) {
      state.batch.push({ student: result.data, lineNumber: row.lineNumber });
      return;
    }
    await this.rejectRow(row.lineNumber, result.error.violations, state);
  }

  /**
   * Enforces email uniqueness (against the database and inside the batch), then persists the
   * survivors with one multi-row INSERT. Previous batches are already committed, so checking
   * the database also catches duplicates spread across batches with O(batch) memory.
   */
  private async flushBatch(state: ImportState): Promise<void> {
    if (state.batch.length === 0) {
      return;
    }
    const pending = state.batch;
    state.batch = [];

    const registered = await this.studentRepository.findExistingEmails(
      pending.map(({ student }) => student.email.value),
    );
    const { unique, duplicates } = this.uniqueness.partition(pending, registered);

    for (const { item, error } of duplicates) {
      await this.rejectRow(item.lineNumber, [error], state);
    }

    if (unique.length > 0) {
      const inserted = await this.studentRepository.bulkInsert(
        unique.map(({ student }) => student),
      );
      state.imported += inserted;

      const skipped = unique.length - inserted;
      if (skipped > 0) {
        // Only reachable when another import inserts the same emails concurrently.
        state.rejected += skipped;
        this.logger.warn(
          { skipped, firstLine: unique[0]?.lineNumber },
          'Rows skipped by the database as duplicates (concurrent import?)',
        );
      }
    }
    this.samplePeakMemory(state);
  }

  private async rejectRow(
    lineNumber: number,
    violations: readonly FieldValidationError[],
    state: ImportState,
  ): Promise<void> {
    state.rejected += 1;
    state.report ??= await this.errorReportWriter.open();

    for (const violation of violations) {
      const error: ValidationError = {
        lineNumber,
        field: violation.field,
        value: violation.value,
        message: violation.message,
      };
      if (state.sampleErrors.length < MAX_ERRORS_IN_RESULT) {
        state.sampleErrors.push(error);
      }
      await state.report.write(error);
    }

    if (state.rejected <= MAX_ROW_WARNINGS) {
      this.logger.warn(
        {
          lineNumber,
          errors: violations.map(({ field, message }) => ({ field, message })),
        },
        'Row skipped',
      );
      if (state.rejected === MAX_ROW_WARNINGS) {
        this.logger.warn(
          { errorReportPath: state.report.path },
          'Further skipped rows are only written to the error report',
        );
      }
    }
  }

  private logProgress(state: ImportState, startedAt: number): void {
    this.samplePeakMemory(state);
    const elapsedMs = this.performanceMonitor.nowMs() - startedAt;
    this.logger.info(
      {
        processed: state.processed,
        imported: state.imported,
        errors: state.rejected,
        rowsPerSecond: this.rate(state.processed, elapsedMs),
        memoryMB: this.round(this.performanceMonitor.memoryUsageMB()),
      },
      'Import progress',
    );
  }

  private samplePeakMemory(state: ImportState): void {
    state.peakMemoryMB = Math.max(state.peakMemoryMB, this.performanceMonitor.memoryUsageMB());
  }

  private buildOutput(state: ImportState, startedAt: number): ImportStudentsOutput {
    this.samplePeakMemory(state);
    const durationMs = Math.round(this.performanceMonitor.nowMs() - startedAt);
    return {
      totalProcessed: state.processed,
      totalImported: state.imported,
      totalErrors: state.rejected,
      errors: state.sampleErrors,
      durationMs,
      peakMemoryMB: this.round(state.peakMemoryMB),
      rowsPerSecond: this.rate(state.processed, durationMs),
      errorReportPath: state.report?.path ?? null,
      aborted: state.aborted,
    };
  }

  private async closeReport(state: ImportState): Promise<void> {
    if (state.report === null) {
      return;
    }
    try {
      await state.report.close();
    } catch (error: unknown) {
      this.logger.error({ err: error, path: state.report.path }, 'Could not close error report');
    }
  }

  private rate(rows: number, elapsedMs: number): number {
    return elapsedMs > 0 ? Math.round((rows * 1000) / elapsedMs) : rows;
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
