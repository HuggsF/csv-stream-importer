import { ApplicationError } from './application.error';

export type ImportProgressSnapshot = {
  readonly totalProcessed: number;
  readonly totalImported: number;
  readonly totalErrors: number;
};

/**
 * Infrastructure failure in the middle of an import (I/O error, malformed CSV, database down…).
 * Batches flushed before the failure stay committed; `progress` tells how far the import got.
 */
export class ImportFailedError extends ApplicationError {
  readonly code = 'IMPORT_FAILED';

  constructor(
    reason: string,
    readonly progress: ImportProgressSnapshot,
    cause?: unknown,
  ) {
    super(`Import failed after ${progress.totalProcessed} rows: ${reason}`, { cause });
  }
}
